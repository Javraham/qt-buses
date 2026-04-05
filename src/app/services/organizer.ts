import { Bus } from "./bus";
import { Passenger } from "../typings/passenger";
import { IBus } from "../typings/BusSelection";
import { catchError, map, Observable, of } from "rxjs";

export class TourOrganizer {
  buses: Bus[];
  pickupLocations: Map<string, Passenger[]>;

  constructor(buses: IBus[]) {
    this.buses = buses.map(bus => new Bus(bus.busId, bus.capacity, bus.color || 'black'));
    this.pickupLocations = new Map();
  }

  getNumOfPassengersByPickup(pickup: string): number {
    const passengers = this.pickupLocations.get(pickup) || [];
    return passengers.reduce((total, passenger) => total + passenger.numOfPassengers, 0);
  }


  loadData(data: Passenger[], pickupGroups: string[][] = []): void {
    for (const passengerData of data) {
      const pickup = passengerData['pickup'];
      const firstName = passengerData['firstName'];
      const lastName = passengerData['lastName'];
      const email = passengerData['email'];
      const numOfPassengers = passengerData['numOfPassengers'];
      const numOfChildren = passengerData['numOfChildren'];
      const hasBoat = passengerData['hasBoat'];
      const hasJourney = passengerData['hasJourney'];
      const startTime = passengerData['startTime'];
      const confirmationCode = passengerData['confirmationCode']
      const phoneNumber = passengerData['phoneNumber']
      const option = passengerData['option']
      const externalBookingReference = passengerData['externalBookingReference']
      const numOfInfants = passengerData['numOfInfants'] ?? 0;

      const passenger: Passenger = {
        confirmationCode,
        pickup,
        email,
        firstName,
        lastName,
        numOfChildren,
        numOfInfants,
        hasBoat,
        numOfPassengers,
        hasJourney,
        startTime,
        phoneNumber,
        option,
        externalBookingReference
      };

      // Determine the bucket key for this passenger
      let mapKey = pickup;
      for (const group of pickupGroups) {
        // If this pickup matches any pickup in the group, use the grouped key
        if (group.some(g => pickup.includes(g))) {
          mapKey = "Group: " + group.join(" + ");
          break;
        }
      }

      if (!this.pickupLocations.has(mapKey)) {
        this.pickupLocations.set(mapKey, []);
      }
      const passengers = this.pickupLocations.get(mapKey) as Passenger[];
      passengers.push(passenger)
      this.pickupLocations.set(mapKey, passengers);
    }
  }

  getSortedLocation() {
    return Array.from(this.pickupLocations).sort((a, b) => {
      return this.getNumOfPassengersByPickup(b[0]) - this.getNumOfPassengersByPickup(a[0]);
    });
  }

  getSplitSortedLocation(index: number) {
    const sortedArray = this.getSortedLocation();
    const [location, passengerList] = sortedArray[0];
    const result = sortedArray.filter(pickup => pickup[0] !== location)
    function splitArrayIntoTwoEvenly(array: Passenger[], index: number): [Passenger[], Passenger[]] {
      // Calculate the midpoint index
      const midpoint = Math.ceil(array.length / 2);

      // Split the array into two subarrays
      const subarray1 = array.slice(0, index);
      const subarray2 = array.slice(index);
      console.log([subarray1, subarray2])
      return [subarray1, subarray2];
    }

    const splitList = splitArrayIntoTwoEvenly(passengerList, index)
    result.push([location, splitList[0]])
    result.push([location, splitList[1]])

    return result.sort((a, b) => b[1].reduce((total, currentValue) => total + currentValue.numOfPassengers, 0) - a[1].reduce((total, currentValue) => total + currentValue.numOfPassengers, 0))
  }

  allocatePassengersV2(
    passengerToBusList: ([string, string])[],
    pickupToBusList: ([string, string])[],
    sortedLocations = this.getSortedLocation(),
    numOfTries: number = 0,
    isSplit: boolean = false
  ): [boolean, boolean] {
    try {
      const totalCapacities = this.buses.reduce((sum, bus) => sum + bus.capacity, 0);
      const totalPassengers = sortedLocations.reduce((val, current) => {
        return val + current[1].reduce((sum, passenger) => sum + passenger.numOfPassengers, 0);
      }, 0);

      console.log(`Total Capacity: ${totalCapacities}, Total Passengers: ${totalPassengers}`);

      // Check if allocation is possible
      if (totalCapacities < totalPassengers) {
        console.error("Not enough capacity for all passengers");
        return [false, false];
      }

      // Prevent infinite recursion
      const maxTries = this.getSortedLocation().length > 0 ? this.getSortedLocation()[0][1].length : 0;
      if (numOfTries >= maxTries) {
        console.error("Max tries exceeded");
        return [false, false];
      }

      const addedPassengers: Set<string> = new Set<string>();

      // Step 1: Handle manual pickup-to-bus assignments
      for (const [pickupLocation, busId] of pickupToBusList) {
        const bus = this.buses.find(bus => bus.busId === busId);
        if (!bus) continue;

        const passengersWithLocation = sortedLocations.find(([pickup, _]) =>
          pickup.includes(pickupLocation)
        );

        if (passengersWithLocation) {
          // Sort larger passenger groups first to optimize bin packing on specific bus
          const passengers = [...passengersWithLocation[1]].sort((a, b) => b.numOfPassengers - a.numOfPassengers);
          for (const passenger of passengers) {
            if (!addedPassengers.has(passenger.confirmationCode)) {
              if (bus.addPassenger(passenger)) {
                addedPassengers.add(passenger.confirmationCode);
              }
            }
          }
        }
      }

      // Step 2: Handle manual passenger-to-bus assignments
      for (const [passengerCode, busId] of passengerToBusList) {
        const bus = this.buses.find(bus => bus.busId === busId);
        if (!bus) continue;

        const locationWithPassenger = sortedLocations.find(([_, passengers]) =>
          passengers.some(passenger => passenger.confirmationCode === passengerCode)
        );

        if (locationWithPassenger) {
          const passenger = locationWithPassenger[1].find(p => p.confirmationCode === passengerCode);
          if (passenger && !addedPassengers.has(passenger.confirmationCode)) {
            if (!bus.addPassenger(passenger)) {
              console.error(`Failed to add passenger ${passengerCode} to bus ${busId}`);
              return [false, false];
            }
            addedPassengers.add(passenger.confirmationCode);
          }
        }
      }

      const shuffle = (array: any[]) => {
        for (let i = array.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [array[i], array[j]] = [array[j], array[i]];
        }
      };

      // Shuffle the sorted locations to get different arrangements each time
      shuffle(sortedLocations);

      // Helper function to allocate a pickup group with progressive splitting strategy
      // Returns [success, busesUsed] where busesUsed is a map of bus to passengers added
      const allocatePickupGroup = (location: string, passengers: Passenger[]): [boolean, Map<Bus, Passenger[]>] => {
        const busesUsed = new Map<Bus, Passenger[]>();

        if (passengers.length === 0) {
          return [true, busesUsed];
        }

        // Filter out already added passengers
        const remainingPassengers = passengers.filter(p => !addedPassengers.has(p.confirmationCode));
        if (remainingPassengers.length === 0) {
          return [true, busesUsed];
        }

        const totalPassengerCount = remainingPassengers.reduce((total, p) => total + p.numOfPassengers, 0);

        // STRATEGY: Try to fit in 1 bus, then 2 buses, then 3 buses, etc.
        // This minimizes the number of buses a pickup group is split across

        const maxBusesToTry = this.buses.length;

        for (let numBusesToUse = 1; numBusesToUse <= maxBusesToTry; numBusesToUse++) {
          console.log(`Trying to fit ${location} group in ${numBusesToUse} bus(es)`);

          // Get all available buses sorted by available capacity
          const availableBuses = [...this.buses]
            .filter(bus => bus.capacity - bus.getCurrentLoad() > 0)
            .sort((a, b) => {
              const aAvailable = a.capacity - a.getCurrentLoad();
              const bAvailable = b.capacity - b.getCurrentLoad();
              return bAvailable - aAvailable;
            });

          if (availableBuses.length < numBusesToUse) {
            continue; // Not enough buses available
          }

          // Try different combinations of buses
          const tryAllocation = (busesToUse: Bus[]): [boolean, Map<Bus, Passenger[]>] => {
            const tempBusesUsed = new Map<Bus, Passenger[]>();
            let tempRemaining = [...remainingPassengers];

            // Sort passengers by size (largest first) for better bin packing
            tempRemaining.sort((a, b) => b.numOfPassengers - a.numOfPassengers);

            for (const bus of busesToUse) {
              if (tempRemaining.length === 0) break;

              const availableSpace = bus.capacity - bus.getCurrentLoad();
              if (availableSpace <= 0) continue;

              const passengersForThisBus: Passenger[] = [];
              let currentLoad = 0;

              // Greedy approach: fit as many passengers as possible
              for (const passenger of tempRemaining) {
                if (currentLoad + passenger.numOfPassengers <= availableSpace) {
                  passengersForThisBus.push(passenger);
                  currentLoad += passenger.numOfPassengers;
                }
              }

              // Add passengers to this bus
              if (passengersForThisBus.length > 0) {
                let addedSuccessfully = true;
                const addedToThisBus: Passenger[] = [];

                for (const passenger of passengersForThisBus) {
                  if (bus.addPassenger(passenger)) {
                    addedToThisBus.push(passenger);
                  } else {
                    addedSuccessfully = false;
                    break;
                  }
                }

                if (addedSuccessfully) {
                  if (!tempBusesUsed.has(bus)) {
                    tempBusesUsed.set(bus, []);
                  }
                  tempBusesUsed.get(bus)!.push(...addedToThisBus);
                  tempRemaining = tempRemaining.filter(p => !addedToThisBus.includes(p));
                } else {
                  // Rollback this bus
                  addedToThisBus.forEach(p => bus.removePassenger(p));
                  // Clean up everything
                  tempBusesUsed.forEach((passengers, b) => {
                    passengers.forEach(p => b.removePassenger(p));
                  });
                  return [false, new Map()];
                }
              }
            }

            // Check if all passengers were allocated
            if (tempRemaining.length === 0) {
              return [true, tempBusesUsed];
            } else {
              // Rollback all changes
              tempBusesUsed.forEach((passengers, bus) => {
                passengers.forEach(p => bus.removePassenger(p));
              });
              return [false, new Map()];
            }
          };

          // If trying to use just 1 bus, try all available buses
          if (numBusesToUse === 1) {
            for (const bus of availableBuses) {
              const [success, tempBusesUsed] = tryAllocation([bus]);
              if (success) {
                console.log(`✓ Fit ${location} in 1 bus`);
                return [true, tempBusesUsed];
              }
            }
          } else {
            // For multiple buses, try the top N buses with most available space
            const busesToTry = availableBuses.slice(0, numBusesToUse);
            const [success, tempBusesUsed] = tryAllocation(busesToTry);

            if (success) {
              console.log(`✓ Fit ${location} in ${numBusesToUse} buses`);
              return [true, tempBusesUsed];
            }
          }
        }

        // If we couldn't allocate with any number of buses
        console.error(`Failed to allocate ${location} group even with all buses`);
        return [false, new Map()];
      };

      const allocate = (index: number): boolean => {
        if (index >= sortedLocations.length) {
          return true;
        }

        let [location, passengers] = sortedLocations[index];

        // Filter out already added passengers
        if (addedPassengers.size) {
          console.log("Passengers: ", passengers.filter(passenger => addedPassengers.has(passenger.confirmationCode)))
          passengers = passengers.filter(passenger => !addedPassengers.has(passenger.confirmationCode))
        }

        // If no passengers left for this location, move to next
        if (passengers.length === 0) {
          return allocate(index + 1);
        }

        // Try to allocate this pickup group (allows splitting if needed)
        const [allocated, busesUsed] = allocatePickupGroup(location, passengers);

        if (allocated) {
          // Mark all allocated passengers as added
          busesUsed.forEach((allocatedPassengers) => {
            allocatedPassengers.forEach(p => addedPassengers.add(p.confirmationCode));
          });

          // Continue with next location
          if (allocate(index + 1)) {
            return true;
          }

          // Backtrack: remove passengers if next allocation failed
          busesUsed.forEach((allocatedPassengers, bus) => {
            allocatedPassengers.forEach(passenger => {
              bus.removePassenger(passenger);
              addedPassengers.delete(passenger.confirmationCode);
            });
          });
        }

        return false;
      }

      const success = allocate(0);

      if (!success) {
        console.error("Unable to allocate all passengers.");
        // Try splitting the largest pickup location
        if (numOfTries < maxTries) {
          return this.allocatePassengers(passengerToBusList, pickupToBusList, this.getSplitSortedLocation(numOfTries), numOfTries + 1, true)
        }
        return [false, false];
      }

      return [success, isSplit];
    } catch (error) {
      console.error(error);
      return [false, false];
    }
  }

  allocatePassengers(passengerToBusList: ([string, string])[], pickupToBusList: ([string, string])[], sortedLocations = this.getSortedLocation(), numOfTries: number = 0, isSplit: boolean = false): [boolean, boolean] {
    try {
      const totalCapacities = this.buses.reduce((bus, currentBus) => bus + currentBus.capacity, 0)
      const totalPassengers = sortedLocations.reduce((val, current) => {
        return val + current[1].reduce((passenger, currentPassenger) => passenger + currentPassenger.numOfPassengers, 0)
      }, 0)
      console.log(sortedLocations)

      if (totalCapacities < totalPassengers) {
        return [false, false]
      }
      else if (numOfTries == this.getSortedLocation()[0][1].length) {
        console.log("Splitting the largest pickup location")
        return this.allocatePassengersV2(passengerToBusList, pickupToBusList, sortedLocations, 0, isSplit)
      }

      const addedPassengers: Set<string> = new Set<string>();

      for (const [pickupLocation, busId] of pickupToBusList) {
        const bus = this.buses.find(bus => bus.busId === busId) as Bus;
        const passengersWithLocation = sortedLocations.find(([pickup, _]) =>
          pickup.includes(pickupLocation)
        );

        if (passengersWithLocation) {
          // Sort larger passenger groups first to optimize bin packing on specific bus
          const passengers = [...passengersWithLocation[1]].sort((a, b) => b.numOfPassengers - a.numOfPassengers);

          for (const passenger of passengers) {
            if (passenger) {
              if (!addedPassengers.has(passenger.confirmationCode)) {
                if (bus.addPassenger(passenger)) {
                  addedPassengers.add(passenger.confirmationCode);
                }
              }
            }
          }
        }
      }

      for (const [passengerCode, busId] of passengerToBusList) {
        const bus = this.buses.find(bus => bus.busId === busId) as Bus;
        const locationWithPassenger = sortedLocations.find(([_, passengers]) =>
          passengers.some(passenger => passenger.confirmationCode === passengerCode)
        );

        if (locationWithPassenger) {
          const passengers = locationWithPassenger[1];
          const passenger = passengers.find(p => p.confirmationCode === passengerCode);

          if (passenger) {
            if (!bus.addPassenger(passenger)) {
              return [false, false]
            }

            addedPassengers.add(passenger.confirmationCode);

          }
        }
      }
      const shuffle = (array: any[]) => {
        for (let i = array.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [array[i], array[j]] = [array[j], array[i]];
        }
      };

      const allocate = (index: number): boolean => {
        if (index >= sortedLocations.length) {
          return true;
        }

        let [location, passengers] = sortedLocations[index];

        if (addedPassengers.size) {
          console.log("Passengers: ", passengers.filter(passenger => addedPassengers.has(passenger.confirmationCode)))
          passengers = passengers.filter(passenger => !addedPassengers.has(passenger.confirmationCode))
        }

        const availableBuses = this.buses.filter(bus =>
          bus.getCurrentLoad() + passengers.reduce((total, currentValue) => total + currentValue.numOfPassengers, 0) <= bus.capacity);

        shuffle(availableBuses); // Shuffle the available buses

        for (const bus of availableBuses) {
          if (bus.getCurrentLoad() + passengers.reduce((total, currentValue) => total + currentValue.numOfPassengers, 0) <= bus.capacity) {
            passengers.forEach(passenger => bus.addPassenger(passenger));
            if (allocate(index + 1)) {
              return true;
            }
            passengers.forEach(passenger => bus.removePassenger(passenger)); // Backtrack
          }
        }

        return false
      }

      const success = allocate(0);

      if (!success) {
        console.error("Unable to allocate all passengers.");
        return this.allocatePassengers(passengerToBusList, pickupToBusList, this.getSplitSortedLocation(numOfTries), numOfTries + 1, true)
      }

      return [success, isSplit];
    } catch (error) {
      console.error(error);
      return [false, false];
    }
  }



}
