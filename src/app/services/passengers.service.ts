import { Injectable } from '@angular/core';
import { Passenger } from "../typings/passenger";
import { PickupsService } from "./pickups.service";
import { lastValueFrom } from "rxjs";
import { IPickup } from "../typings/ipickup";
import { OptionsService } from "./options.service";
import { IBookingOptions } from "../typings/IBookingOptions";

@Injectable({
  providedIn: 'root'
})
export class PassengersService {

  constructor(private pickupService: PickupsService, private optionService: OptionsService) { }

  getPassengersByTime(passengers: Passenger[]): Map<string, Passenger[]> {
    const map: Map<string, Passenger[]> = new Map<string, Passenger[]>();
    for (const passenger of passengers) {
      if (map.has(passenger.startTime)) {
        let passengers = map.get(passenger.startTime) as Passenger[]
        passengers.push(passenger)
        map.set(passenger.startTime, passengers)
      }
      else {
        map.set(passenger.startTime, [passenger])
      }
    }
    return map
  }

  getPassengerByConfirmationID(passengers: Passenger[], confirmationID: string): Passenger | undefined {
    return passengers.find(passenger => passenger.confirmationCode === confirmationID)
  }

  getTotalPassengers(passengers: Passenger[] | undefined) {
    if (passengers)
      return passengers.reduce((total, passenger) => total + passenger.numOfPassengers, 0);

    return 0
  }

  getPassengersByPickupLocation(location: string, passengers: Passenger[]): Passenger[] {
    return passengers.filter(passenger => passenger.pickup === location)
  }

  async getPickupLocationAbbreviations(pickups: string[]): Promise<any[]> {
    const result = await lastValueFrom(this.pickupService.getPickupLocations());

    return pickups
      .map(pickup => {
        return {
          pickup,
          ...result.data.find((location: any) => pickup.toLowerCase().includes(location.name.toLowerCase()))
        }
      }).filter(abbrev => abbrev); // Filters out undefined values
  }

  getPickupLocationsFromPassengers(passengers: Passenger[], pickupAbbrevs: any) {
    const map = this.getPassengersByTime(passengers);
    const pickupMap: Map<string, string[]> = new Map<string, string[]>

    for (const [key, passengers] of map.entries()) {
      const set: Set<string> = new Set();
      for (const passenger of passengers) {
        for (const pickup of pickupAbbrevs) {
          if (passenger.pickup.includes(pickup.name)) {
            set.add(pickup.name)
          }
        }
      }

      pickupMap.set(key, Array.from(set));
    }

    console.log(pickupMap)

    return pickupMap
  }


  getTotalPassengersByPickupLocations(passengers: Passenger[]): Map<string, number> {
    const pickupLocations: Map<string, number> = new Map<string, number>();
    for (const passenger of passengers) {
      if (!pickupLocations.has(passenger.pickup)) {
        pickupLocations.set(passenger.pickup, passenger.numOfPassengers);
      } else {
        let numOfPassengers = pickupLocations.get(passenger.pickup) as number
        pickupLocations.set(passenger.pickup, numOfPassengers + passenger.numOfPassengers);
      }
    }

    // return pickupLocations

    try {
      const extractTime = (str: any) => {
        const timeMatch = str.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/);
        if (timeMatch) {
          let [, hours, minutes, period] = timeMatch;
          hours = parseInt(hours);
          minutes = parseInt(minutes);
          if (period === "PM" && hours !== 12) hours += 12;
          if (period === "AM" && hours === 12) hours = 0;
          return hours * 60 + minutes; // Convert time to minutes since midnight
        }
        return 0;
      }

      const getNumber = (str: string) => {
        const match = str.match(/[\[(](\d+(\.\d+)?)[\])]/);
        return match ? parseFloat(match[1]) : -1;
      };

      return new Map(
        Array.from(pickupLocations.keys())
          .sort((a, b) => getNumber(a) - getNumber(b))
          .map(key => [key, pickupLocations.get(key) as number])
      );

    } catch {
      return pickupLocations;
    }
  }

  getBoatPassengers(passengers: Passenger[]): Passenger[] {
    return passengers.filter(passenger => passenger.hasBoat && !passenger.hasJourney);
  }

  getOptionsToPassengers(passengers: Passenger[], sortedOptions?: any) {
    function getNumber(str: string) {
      const match = str.match(/[\[(](\d+(\.\d+)?)[\])]/);
      return match ? parseFloat(match[1]) : -1;
    }
    const sortKeys = (map: Map<string, Passenger[]>, sortedOptions?: any) => {

      // Get the map's keys and sort them according to the sortOrder array
      const sortedKeys = Array.from(map.keys()).sort((a: string, b: string) => {
        return sortedOptions.indexOf(a) - sortedOptions.indexOf(b);
      });

      // Create a new sorted map
      const sortedMap = new Map();
      for (const key of sortedKeys) {
        sortedMap.set(key, map.get(key));
      }

      return sortedMap;
    }
    const optionsMap = new Map<string, Passenger[]>();
    for (const passenger of passengers) {
      if (!optionsMap.has(passenger.option)) {
        optionsMap.set(passenger.option, [passenger]);
      } else {
        let passengerList = optionsMap.get(passenger.option) as Passenger[]
        passengerList.push(passenger)
        optionsMap.set(passenger.option, passengerList);
      }
    }

    for (const key of optionsMap.keys()) {
      const passengers = optionsMap.get(key) as Passenger[] || [];

      passengers.sort((a, b) => getNumber(a.pickup) - getNumber(b.pickup));

      // Update the map with the sorted array
      optionsMap.set(key, passengers);
    }
    if (sortedOptions) return sortKeys(optionsMap, sortedOptions)
    else return optionsMap
  }

  getNumOfPassengersForOption(option: string, passengers: Passenger[]) {
    const passengerList = this.getOptionsToPassengers(passengers).get(option) || [];
    const adults = passengerList.reduce((total: number, passenger: Passenger) => total + (passenger.numOfPassengers - passenger.numOfChildren), 0);
    const children = passengerList.reduce((total: number, passenger: Passenger) => total + passenger.numOfChildren, 0);
    const infants = passengerList.reduce((total: number, passenger: Passenger) => total + (passenger.numOfInfants ?? 0), 0);
    return [adults, children, infants];
  }

  getNumOfPassengersByTime(passengers: Passenger[], time: string) {
    return passengers.reduce((prev: number, curr) => {
      if (curr.startTime === time) {
        return prev + curr.numOfPassengers
      }
      else {
        return prev
      }
    }, 0)
  }

  getJourneyPassengers(passengers: Passenger[]): Passenger[] {
    return passengers.filter(passenger => passenger.hasJourney);
  }

  getNumOfBoatPassengers(passengers: Passenger[]): [number, number] {
    const adults = this.getBoatPassengers(passengers).reduce((total, passenger) => total + (passenger.numOfPassengers - passenger.numOfChildren), 0);
    const children = this.getBoatPassengers(passengers).reduce((total, passenger) => total + passenger.numOfChildren, 0);
    return [adults, children];
  }

  getNumOfJourneyPassengers(passengers: Passenger[]): [number, number] {
    const adults = this.getJourneyPassengers(passengers).reduce((total, passenger) => total + (passenger.numOfPassengers - passenger.numOfChildren), 0);
    const children = this.getJourneyPassengers(passengers).reduce((total, passenger) => total + passenger.numOfChildren, 0);
    return [adults, children];
  }

  getNumOfNoBoatPassengers(passengers: Passenger[]): [number, number] {
    const adults = this.getNoBoatPassengers(passengers).reduce((total, passenger) => total + (passenger.numOfPassengers - passenger.numOfChildren), 0);
    const children = this.getNoBoatPassengers(passengers).reduce((total, passenger) => total + passenger.numOfChildren, 0);
    return [adults, children];
  }

  getNoBoatPassengers(passengers: Passenger[]): Passenger[] {
    return passengers.filter(passenger => !passenger.hasBoat);
  }

  /**
   * Sort passengers by their pickup location's priority.
   * Passengers whose pickup doesn't match any known pickup are pushed to the end.
   */
  sortByPickupPriority(passengers: Passenger[], pickupAbbrevs: IPickup[]): Passenger[] {
    const getPriority = (pickup: string): number => {
      const match = pickupAbbrevs.find(p => pickup.toLowerCase().includes(p.name.toLowerCase()));
      return match?.priority ?? Number.MAX_SAFE_INTEGER;
    };
    return [...passengers].sort((a, b) => getPriority(a.pickup) - getPriority(b.pickup));
  }
}
