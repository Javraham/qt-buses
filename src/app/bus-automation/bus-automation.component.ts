import { Component, ElementRef, HostListener, OnInit } from '@angular/core';
import { BusSelectionButtonsComponent } from "../bus-selection-buttons/bus-selection-buttons.component";
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from "@angular/forms";
import { NgForOf, NgIf, NgClass } from "@angular/common";
import { PassengerComponent } from "../passenger/passenger.component";
import { FetchBookingDataOptions } from "../typings/fetch-data-booking-options";
import { Passenger } from "../typings/passenger";
import { Bus } from "../services/bus";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { IBus } from "../typings/BusSelection";
import { ApiService } from "../services/api.service";
import { MessageService } from "../services/message.service";
import { TourOrganizerService } from "../services/tour-organizer.service";
import { PassengersService } from "../services/passengers.service";
import { TourOrganizer } from "../services/organizer";
import { BusService } from "../services/bus.service";
import { PickupsService } from "../services/pickups.service";
import { lastValueFrom } from "rxjs";
import { IPickup } from "../typings/ipickup";
import { ActivatedRoute, Router } from "@angular/router";
import { DriversService } from "../services/drivers.service";
import { IDriver } from "../typings/IDriver";
import { PublishedAssignmentsService } from "../services/published-assignments.service";
import { IPublishedAssignment, IBusAssignment, IAssignedPassenger } from "../typings/IPublishedAssignment";
import { ToursService } from "../services/tours.service";
import { ITour } from "../typings/itour";
import { AnnouncementsService } from "../services/announcements.service";

@Component({
  selector: 'app-bus-automation',
  standalone: true,
  imports: [
    BusSelectionButtonsComponent,
    FormsModule,
    NgForOf,
    NgIf,
    PassengerComponent,
    ReactiveFormsModule,
  ],
  templateUrl: './bus-automation.component.html',
  styleUrl: './bus-automation.component.css'
})
export class BusAutomationComponent implements OnInit {
  passengers: Passenger[] = [];
  date: string = '';
  busList: Bus[] = [];
  htmlContent: SafeHtml = "";
  busSelections: Map<string, string[]> = new Map<string, string[]>;
  usedBuses: Map<string, string[]> = new Map<string, string[]>;
  successMap: Map<string, [boolean, boolean]> = new Map<string, [boolean, boolean]>();
  excludedPassengersMap: Map<string, Passenger[]> = new Map<string, Passenger[]>();
  excludedPassengers: Passenger[] = [];
  loadContent: boolean = false;
  isAuthorized: boolean = false; // Will be set in ngOnInit after expiration check
  errorMsg: string = "";
  loading: boolean = false;
  canEdit: boolean = false;
  allBuses !: IBus[];
  passengerToBusMap = new Map<string, string>();
  scheduleMap = new Map<string, Map<string, string>>();
  isPickupToBusOpen = new Map<string, boolean>();
  pickupGroups = new Map<string, string[][]>();
  isPickupGroupingOpen = new Map<string, boolean>();
  form = new FormGroup({
    accessKey: new FormControl('', Validators.required),
    secretKey: new FormControl('', [Validators.required, Validators.email])
  });
  pickupAbbrevs !: IPickup[];

  // Driver assignment properties
  drivers: IDriver[] = [];
  busToDriverMap = new Map<string, string>();  // busId -> driverId
  busToDriverNotesMap = new Map<string, string>();  // busId-time -> notes
  isPublishing: boolean = false;
  openDropdowns = new Map<string, boolean>(); // Track which dropdowns are open

  // Notes modal properties
  isNotesModalOpen: boolean = false;
  currentNotesKey: string = '';
  currentNotesBusId: string = '';
  currentNotesTime: string = '';
  editingNotes: string = '';

  // Email sending properties
  sendingEmail: boolean = false;
  emailMessage: string = '';
  emailError: string = '';

  // Saved assignment properties
  savedAssignment: IPublishedAssignment | null = null;
  unsortedPassengers: Passenger[] = [];

  // Tours data
  tours: ITour[] = [];

  // Cached time slots to prevent re-rendering on every change detection
  cachedTimeSlots: [string, number][] = [];

  // Announcements
  announcementText: string = '';
  includeAnnouncement: Map<string, boolean> = new Map(); // time -> boolean
  toast: { message: string, type: 'success' | 'error' } | null = null;
  private toastTimeout: any;


  trackByConfirmationID(index: number, passenger: Passenger) {
    return passenger.confirmationCode
  }

  // TrackBy function for time slots to prevent re-rendering
  trackByTimeSlot(index: number, timeSlot: [string, number]): string {
    return timeSlot[0]; // Track by the time string
  }

  updateBusSelections(event: [string[], string]) {
    const prevValue = this.busSelections.get(event[1]) || []

    this.busSelections.set(event[1], event[0])
    for (const key of this.passengerToBusMap.keys()) {
      console.log(event[0], this.passengerToBusMap.get(key))
      if (!event[0].includes(<string>this.passengerToBusMap.get(key)) && this.passengerService.getPassengerByConfirmationID(this.passengers, key)?.startTime === event[1]) {
        this.passengerToBusMap.set(key, "No Bus Selected")
      }
    }
  }

  updateUsedBuses(event: [string[], string]) {
    this.usedBuses.set(event[1], event[0]);
    this.excludedPassengersMap.set(event[1], this.excludedPassengers.filter(val => val.startTime == event[1]));
    const filteredPassengers = this.getPassengersByTime(event[1]).filter(val => this.excludedPassengers.filter(passenger => passenger.confirmationCode == val.confirmationCode).length == 0)
    const filteredBuses = this.allBuses.filter(val => event[0].includes(val.busId))
    this.organizePassengers(filteredBuses, filteredPassengers, Array.from(this.scheduleMap.get(event[1]) || new Map()), this.pickupGroups.get(event[1]) || []);
  }

  reSortBuses(time: string) {
    const used = this.usedBuses.get(time) || [];
    this.updateUsedBuses([used, time]);
  }

  constructor(private router: Router,
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer,
    private apiService: ApiService,
    private tourBusOrganizer: TourOrganizerService,
    private passengerService: PassengersService,
    private busService: BusService,
    private pickupsService: PickupsService,
    private driversService: DriversService,
    private publishedAssignmentsService: PublishedAssignmentsService,
    private messageService: MessageService,
    private eRef: ElementRef,
    private toursService: ToursService,
    private announcementsService: AnnouncementsService
  ) {
  }

  toggleAnnouncement(time: string, event: any) {
    this.includeAnnouncement.set(time, event.target.checked);
  }

  showToast(message: string, type: 'success' | 'error' = 'success') {
    this.toast = { message, type };
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toast = null;
    }, 3000);
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      const storedDate = params['date'];
      if (storedDate) {
        this.date = storedDate;
      } else {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are zero-based, so add 1
        const day = String(today.getDate()).padStart(2, '0');
        this.date = `${year}-${month}-${day}`;
      }

      // Check if keys exist and are not expired
      const hasKeys = localStorage.getItem('access') != null && localStorage.getItem('secret') != null;
      if (hasKeys && this.apiService.areKeysExpired()) {
        // Keys expired, clear them
        this.apiService.clearKeys();
        this.isAuthorized = false;
      } else {
        this.isAuthorized = hasKeys;
      }

      if (this.isAuthorized) {
        this.loadPassengers()
        this.form.get('accessKey')?.disable();
        this.form.get('secretKey')?.disable();
      }
      console.log(localStorage.getItem('access'))
      console.log(this.isAuthorized)
    })

    // Fetch announcement
    this.announcementsService.getAnnouncement().subscribe({
      next: (response) => {
        // Handle various response structures depending on API/Local Mock
        const message = response.data?.message || response.message || response || '';
        if (typeof message === 'string') {
          this.announcementText = message;
        } else if (response.data && typeof response.data === 'string') {
          this.announcementText = response.data;
        }
      },
      error: (err) => console.error(err)
    });
  }

  /** Auto-regenerate the HTML list content whenever state changes */
  async refreshHTMLContent() {
    try {
      const printedResult = await this.tourBusOrganizer.printResult(this.busToDriverMap, this.drivers, this.busToDriverNotesMap);
      this.htmlContent = this.sanitizer.bypassSecurityTrustHtml(printedResult);
    } catch (e) {
      console.error('Failed to refresh HTML content:', e);
    }
  }

  /** Send the already-generated list via email */
  async emailList() {
    const el = document.getElementById('generated-txt');
    const htmlContent = el?.innerHTML || '';
    if (!htmlContent.trim()) {
      this.showToast('No list content to email.', 'error');
      return;
    }
    await this.sendListToEmail(htmlContent);
  }

  async sendListToEmail(htmlContent: string) {
    this.sendingEmail = true;
    // this.emailMessage = '';
    // this.emailError = '';

    try {

      const emailData = {
        htmlContent: htmlContent,
        subject: `Bus Assignments for ${this.date}`,
        date: this.date
      };

      const result = await lastValueFrom(this.messageService.sendAdminEmail(emailData));
      if (result && (result.success === false || result.error)) {
        throw new Error(result.message || result.error || 'Failed to send email');
      }
      this.showToast('List successfully sent to your email!', 'success');
    } catch (error: any) {
      console.error('Failed to send email:', error);
      this.showToast(`Failed to send email: ${error.message || 'Unknown error'}`, 'error');
    } finally {
      this.sendingEmail = false;
    }
  }

  onDateChange(event: any) {
    this.date = event.target.value;
    this.router.navigate([], { queryParams: { date: this.date } });
  }

  getBusesByTime(time: string) {
    return this.tourBusOrganizer.getBusesByTime(time)
  }

  resetBusesForTime(event: [string, number]) {
    this.usedBuses.delete(event[0]);
    this.successMap.delete(event[0]);
    this.busSelections.delete(event[0]);
    for (const key of this.passengerToBusMap.keys()) {
      if (this.passengerService.getPassengerByConfirmationID(this.passengers, key)?.startTime === event[0]) {
        this.passengerToBusMap.delete(key)
      }
    }
    console.log(this.passengerToBusMap)
    this.tourBusOrganizer.resetBusesForTime(event[0]);
    this.refreshHTMLContent();
  }

  resetBusSelection() {
    this.excludedPassengers = []
    this.busSelections = new Map<string, string[]>()
    this.passengerToBusMap = new Map<string, string>()
  }

  organizePassengers(busInfoList: IBus[], passengers: Passenger[], pickupToBusMap: [string, string][], pickupGroups: string[][] = []) {
    console.log(this.passengerToBusMap);
    const passengerToBusList = Array.from(this.passengerToBusMap).filter(item => busInfoList.map(bus => bus.busId).includes(item[1]))
    console.log(passengerToBusList)
    const organizer = new TourOrganizer(busInfoList)
    organizer.loadData(passengers, pickupGroups)
    const isAllocated = organizer.allocatePassengers(passengerToBusList, pickupToBusMap)
    if (isAllocated[0]) {
      console.log(isAllocated)
      organizer.buses.forEach(bus => {
        console.log(bus, bus.getCurrentLoad())
      })
      this.busList = organizer.buses;
      this.tourBusOrganizer.setBuses(passengers[0].startTime, organizer.buses);
      this.successMap.set(passengers[0].startTime, isAllocated)
    }
    else {
      this.successMap.set(passengers[0].startTime, isAllocated)
    }

    this.busList = organizer.buses;
    this.refreshHTMLContent();
  }

  getNumOfPassengersByTime() {
    const passengers = this.passengers.filter(passenger => this.excludedPassengers.filter(val => passenger.confirmationCode == val.confirmationCode).length == 0)
    const map: Map<string, number> = new Map<string, number>();
    for (const passenger of this.passengers) {
      if (map.has(passenger.startTime)) {
        let passengers = map.get(passenger.startTime) as number
        passengers += this.excludedPassengers.find(val => val.confirmationCode == passenger.confirmationCode) == undefined ? passenger.numOfPassengers : 0;
        map.set(passenger.startTime, passengers)
      }
      else {
        map.set(passenger.startTime, this.excludedPassengers.find(val => val.confirmationCode == passenger.confirmationCode) == undefined ? passenger.numOfPassengers : 0)
      }
    }

    return Array.from(map.entries()).sort((a, b) => {
      const timeA = a[0];
      const timeB = b[0];
      return timeA.localeCompare(timeB);
    });
  }

  // Call this method when passenger data changes to update the cached time slots
  refreshTimeSlots() {
    this.cachedTimeSlots = this.getNumOfPassengersByTime();
  }

  getUnsortedPassengerTimes(): string[] {
    // Get array of times that have unsorted passengers
    const times: string[] = [];
    for (const [time, passengers] of this.excludedPassengersMap.entries()) {
      if (passengers && passengers.length > 0) {
        times.push(time);
      }
    }
    return times;
  }

  getUnsortedTimesFormatted(): string {
    // Format the times for display (remove leading zero if present)
    const times = this.getUnsortedPassengerTimes();
    return times.map(t => t[0] === '0' ? t.slice(1) : t).join(', ');
  }

  getPassengersByTime(time: string) {
    const filtered = this.passengers.filter(val => val.startTime == time);
    return this.passengerService.sortByPickupPriority(filtered, this.pickupAbbrevs);
  }

  /** Sort passengers by pickup priority — used in template for sorted bus display */
  getSortedPassengers(passengers: Passenger[]): Passenger[] {
    return this.passengerService.sortByPickupPriority(passengers, this.pickupAbbrevs);
  }

  updatePassengerExclusionList(event: Passenger) {
    const time = event.startTime;
    const busesForTime = this.tourBusOrganizer.getBusesByTime(time);

    // Check if this passenger is currently in a sorted bus
    let isInBus = false;
    if (busesForTime) {
      for (const bus of busesForTime) {
        if (bus.passengers.find(p => p.confirmationCode === event.confirmationCode)) {
          isInBus = true;
          break;
        }
      }
    }

    if (isInBus) {
      // Passenger is in a bus - move them to unsorted section
      this.movePassengerToUnsorted(event);
    } else {
      // Passenger is either unsorted or pre-sort - toggle exclusion for the sort algorithm
      if (this.excludedPassengers.filter(val => val.confirmationCode == event.confirmationCode).length != 0) {
        const index = this.excludedPassengers.findIndex(val => val.confirmationCode == event.confirmationCode);
        this.excludedPassengers.splice(index, 1);

        // Also remove from unsortedPassengers if there
        const unsortedIdx = this.unsortedPassengers.findIndex(p => p.confirmationCode === event.confirmationCode);
        if (unsortedIdx !== -1) {
          this.unsortedPassengers.splice(unsortedIdx, 1);
        }

        // Also remove from excludedPassengersMap
        const timeExcluded = this.excludedPassengersMap.get(time);
        if (timeExcluded) {
          const idx = timeExcluded.findIndex(p => p.confirmationCode === event.confirmationCode);
          if (idx !== -1) {
            timeExcluded.splice(idx, 1);
            this.excludedPassengersMap.set(time, timeExcluded);
          }
        }
      }
      else {
        this.excludedPassengers.push(event);
      }
    }
    console.log('Exclusion list updated:', this.excludedPassengersMap);
  }

  getNextDayPassengers() {
    const [year, month, day] = this.date.split('-').map(Number);

    // Create a new Date object using the provided date
    const date = new Date(year, month - 1, day); // month is zero-indexed

    // Add one day to the date
    date.setDate(date.getDate() + 1);

    // Extract the components of the next day
    const nextYear = date.getFullYear();
    const nextMonth = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-indexed
    const nextDay = String(date.getDate()).padStart(2, '0');

    this.date = `${nextYear}-${nextMonth}-${nextDay}`;
    this.router.navigate([], { queryParams: { date: this.date } });
    console.log(this.date)
  }

  async loadPassengers() {
    try {
      this.errorMsg = "";
      this.loading = true;
      const passengers = await this.apiService.getPassengersFromProductBookings(this.date, this.apiService.fetchOptions)
      const result = await lastValueFrom(this.pickupsService.getPickupLocations())
      const busesResult = await lastValueFrom(this.busService.getBuses())

      // Load drivers
      const driversResult = await lastValueFrom(this.driversService.getDrivers())
      this.drivers = driversResult.data.sort((a: IDriver, b: IDriver) => a.name.localeCompare(b.name)) || [];

      // Load tours
      const toursResult = await lastValueFrom(this.toursService.getTours())
      this.tours = toursResult.data || [];

      this.allBuses = busesResult.data.sort((a: any, b: any) => {
        return a.sortOrder - b.sortOrder;
      });
      this.pickupAbbrevs = result.data;
      this.loading = false
      this.loadContent = true;
      this.passengers = passengers
      this.canEdit = false
      this.apiService.markValidated();
      this.usedBuses = new Map<string, string[]>();
      this.successMap = new Map<string, [boolean, boolean]>();
      this.busToDriverMap = new Map<string, string>();  // Reset driver assignments
      this.busToDriverNotesMap = new Map<string, string>();  // Reset driver notes
      this.resetBusSelection()
      this.tourBusOrganizer.resetBuses();
      this.unsortedPassengers = [];
      this.savedAssignment = null;

      // this.emailMessage = '';
      // this.emailError = '';
      try {
        const savedResult = await lastValueFrom(this.publishedAssignmentsService.getAssignmentsByDate(this.date));
        if (savedResult && savedResult.data) {
          this.savedAssignment = savedResult.data;
          this.reconcileAssignments(passengers, savedResult.data);
        } else {
          // No saved assignment, all passengers are unsorted
          this.tourBusOrganizer.setTimeToPassengersMap(this.passengerService.getPassengersByTime(this.passengers))
        }
      } catch (e) {
        // No saved assignment found, proceed normally
        console.log('No saved assignment for this date');
        this.tourBusOrganizer.setTimeToPassengersMap(this.passengerService.getPassengersByTime(this.passengers))
      }

      // Refresh cached time slots after loading passengers
      this.refreshTimeSlots();

      // Auto-generate the HTML list
      this.refreshHTMLContent();

      console.log(passengers)

      console.log(this.passengerService.getPickupLocationsFromPassengers(passengers, this.pickupAbbrevs));
    }
    catch (e: any) {
      this.loading = false
      this.errorMsg = e.message;
      this.loadContent = false
    }
  }

  /**
   * Reconcile saved assignments with fresh passenger data from API.
   * - Passengers in saved assignment that exist in fresh data: restore to their bus
   * - Passengers in saved assignment that don't exist in fresh data: removed (skip)
   * - Passengers in fresh data not in saved assignment: add to unsortedPassengers
   */
  reconcileAssignments(freshPassengers: Passenger[], savedAssignment: IPublishedAssignment) {
    // Create a map of confirmationCode -> Passenger for quick lookup
    const freshPassengerMap = new Map<string, Passenger>();
    for (const passenger of freshPassengers) {
      freshPassengerMap.set(passenger.confirmationCode, passenger);
    }

    // Track which passengers have been assigned
    const assignedCodes = new Set<string>();

    // Group assignments by time slot
    const timeToAssignments = new Map<string, IBusAssignment[]>();
    for (const assignment of savedAssignment.assignments) {
      if (!timeToAssignments.has(assignment.time)) {
        timeToAssignments.set(assignment.time, []);
      }
      timeToAssignments.get(assignment.time)!.push(assignment);
    }

    // Process each time slot
    for (const [time, assignments] of timeToAssignments.entries()) {
      const busesForTime: Bus[] = [];
      const busIdsUsed: string[] = [];

      for (const assignment of assignments) {
        // Find the bus configuration
        const busConfig = this.allBuses.find(b => b.busId === assignment.busId);
        if (!busConfig) continue;

        const bus = new Bus(assignment.busId, busConfig.capacity, busConfig.color || 'black');

        // Add passengers that still exist in fresh data
        for (const savedPassenger of assignment.passengers) {
          const freshPassenger = freshPassengerMap.get(savedPassenger.confirmationCode);
          if (freshPassenger) {
            // Passenger still exists - add with fresh data (may have been modified)
            bus.passengers.push(freshPassenger);
            assignedCodes.add(savedPassenger.confirmationCode);
          }
          // If passenger doesn't exist in fresh data, they were removed - skip
        }

        busesForTime.push(bus);
        busIdsUsed.push(assignment.busId);

        // Restore driver assignment and notes
        if (assignment.driverId) {
          this.busToDriverMap.set(`${assignment.busId}-${time}`, assignment.driverId);
        }
        if (assignment.notes) {
          this.busToDriverNotesMap.set(`${assignment.busId}-${time}`, assignment.notes);
        }
        if (assignment.announcement) {
          this.includeAnnouncement.set(time, true);
        }
      }

      // Set the buses in the tour organizer service
      if (busesForTime.length > 0) {
        this.tourBusOrganizer.setBuses(time, busesForTime);
        this.usedBuses.set(time, busIdsUsed);
        this.busSelections.set(time, busIdsUsed);
        this.successMap.set(time, [true, false]); // Mark as successfully allocated
      }
    }

    // Find passengers that were not in any saved assignment (new passengers)
    this.unsortedPassengers = [];
    for (const passenger of freshPassengers) {
      if (!assignedCodes.has(passenger.confirmationCode)) {
        this.unsortedPassengers.push(passenger);
      }
    }

    // Also put unsorted passengers in excludedPassengers for compatibility
    // Sort unsorted passengers by pickup priority
    this.unsortedPassengers = this.passengerService.sortByPickupPriority(this.unsortedPassengers, this.pickupAbbrevs);
    this.excludedPassengers = [...this.unsortedPassengers];

    // Group unsorted passengers by time and add to excludedPassengersMap
    const unsortedByTime = new Map<string, Passenger[]>();
    for (const passenger of this.unsortedPassengers) {
      if (!unsortedByTime.has(passenger.startTime)) {
        unsortedByTime.set(passenger.startTime, []);
      }
      unsortedByTime.get(passenger.startTime)!.push(passenger);
    }
    this.excludedPassengersMap = unsortedByTime;

    // Set the time to passengers map for any time slots without saved assignments
    this.tourBusOrganizer.setTimeToPassengersMap(this.passengerService.getPassengersByTime(this.passengers));

    console.log('Reconciliation complete:', {
      totalPassengers: freshPassengers.length,
      assignedPassengers: assignedCodes.size,
      unsortedPassengers: this.unsortedPassengers.length,
      restoredTimeSlots: timeToAssignments.size
    });
  }

  getPickupAbbrevByTime(time: string) {
    return this.passengerService.getPickupLocationsFromPassengers(this.passengers, this.pickupAbbrevs).get(time);
  }

  Authorize() {
    if (!this.isAuthorized) {
      this.apiService.setKeys(this.form.value);
      this.form.reset();
      this.form.get('accessKey')?.disable();
      this.form.get('secretKey')?.disable();
      this.loadPassengers()
    }

    else {
      this.apiService.clearKeys();
      this.form.get('accessKey')?.enable();
      this.form.get('secretKey')?.enable();
    }
    this.isAuthorized = !this.isAuthorized;
  }

  getPrevDayPassengers() {
    const [year, month, day] = this.date.split('-').map(Number);

    // Create a new Date object using the provided date
    const date = new Date(year, month - 1, day); // month is zero-indexed

    // Add one day to the date
    date.setDate(date.getDate() - 1);

    // Extract the components of the next day
    const nextYear = date.getFullYear();
    const nextMonth = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-indexed
    const nextDay = String(date.getDate()).padStart(2, '0');

    this.date = `${nextYear}-${nextMonth}-${nextDay}`;
    this.router.navigate([], { queryParams: { date: this.date } });
  }

  toggleEditCapacities() {
    this.canEdit = !this.canEdit
  }

  editCapacity(busId: string, event: any) {
    console.log(event)
    this.allBuses.forEach(bus => {
      if (bus.busId === busId) {
        bus.capacity = parseInt(event.target.value)
      }
    })
  }

  updatePassengerBusList(event: [Passenger, IBus]) {
    const passenger = event[0];
    const targetBus = event[1];

    // Immediately move the passenger to the target bus
    this.movePassengerToBus(passenger, targetBus.busId, passenger.startTime);

    // Clear the edit mode for this passenger
    this.passengerToBusMap.delete(passenger.confirmationCode);
  }

  /**
   * Move a passenger from their current location (unsorted or another bus) to a target bus
   */
  movePassengerToBus(passenger: Passenger, targetBusId: string, time: string) {
    // Get all buses for this time slot
    const busesForTime = this.tourBusOrganizer.getBusesByTime(time);

    if (!busesForTime) {
      console.error('No buses found for time:', time);
      return;
    }

    // Find the target bus
    const targetBus = busesForTime.find(b => b.busId === targetBusId);
    if (!targetBus) {
      console.error('Target bus not found:', targetBusId);
      return;
    }

    // Remove passenger from unsorted list if they're there
    const unsortedIndex = this.unsortedPassengers.findIndex(p => p.confirmationCode === passenger.confirmationCode);
    if (unsortedIndex !== -1) {
      this.unsortedPassengers.splice(unsortedIndex, 1);
    }

    // Remove from excludedPassengers for compatibility
    const excludedIndex = this.excludedPassengers.findIndex(p => p.confirmationCode === passenger.confirmationCode);
    if (excludedIndex !== -1) {
      this.excludedPassengers.splice(excludedIndex, 1);
    }

    // Remove from excludedPassengersMap
    const timeExcluded = this.excludedPassengersMap.get(time);
    if (timeExcluded) {
      const idx = timeExcluded.findIndex(p => p.confirmationCode === passenger.confirmationCode);
      if (idx !== -1) {
        timeExcluded.splice(idx, 1);
        this.excludedPassengersMap.set(time, timeExcluded);
      }
    }

    // Remove passenger from any other bus they might be in
    for (const bus of busesForTime) {
      const passengerIndex = bus.passengers.findIndex(p => p.confirmationCode === passenger.confirmationCode);
      if (passengerIndex !== -1) {
        bus.passengers.splice(passengerIndex, 1);
      }
    }

    // Add passenger to target bus
    targetBus.passengers.push(passenger);

    console.log(`Moved ${passenger.firstName} ${passenger.lastName} to bus ${targetBusId}`);
    this.refreshHTMLContent();
  }

  /**
   * Move a passenger from their current bus to the unsorted section
   */
  movePassengerToUnsorted(passenger: Passenger) {
    const time = passenger.startTime;

    // Get all buses for this time slot
    const busesForTime = this.tourBusOrganizer.getBusesByTime(time);

    if (busesForTime) {
      // Remove passenger from any bus they're in
      for (const bus of busesForTime) {
        const passengerIndex = bus.passengers.findIndex(p => p.confirmationCode === passenger.confirmationCode);
        if (passengerIndex !== -1) {
          bus.passengers.splice(passengerIndex, 1);
        }
      }
    }

    // Add to unsorted if not already there
    if (!this.unsortedPassengers.find(p => p.confirmationCode === passenger.confirmationCode)) {
      this.unsortedPassengers.push(passenger);
    }

    // Also add to excludedPassengers for compatibility
    if (!this.excludedPassengers.find(p => p.confirmationCode === passenger.confirmationCode)) {
      this.excludedPassengers.push(passenger);
    }

    // Update excludedPassengersMap
    const timeExcluded = this.excludedPassengersMap.get(time) || [];
    if (!timeExcluded.find(p => p.confirmationCode === passenger.confirmationCode)) {
      timeExcluded.push(passenger);
      // Re-sort by pickup priority
      this.excludedPassengersMap.set(time, this.passengerService.sortByPickupPriority(timeExcluded, this.pickupAbbrevs));
    }

    console.log(`Moved ${passenger.firstName} ${passenger.lastName} to unsorted`);
    this.refreshHTMLContent();
  }

  updatePickupBusList(pickup: string, busId: string, time: string) {
    const map = this.scheduleMap.get(time) || new Map<string, string>
    map.set(pickup, busId)
    this.scheduleMap.set(time, map)
    console.log(this.scheduleMap)
  }

  removePickup(pickup: string, time: string) {
    const map = this.scheduleMap.get(time) || new Map<string, string>
    map.delete(pickup)
    console.log(this.scheduleMap)
  }

  addPickupGroup(time: string) {
    const groups = this.pickupGroups.get(time) || [];
    groups.push([]);
    this.pickupGroups.set(time, groups);
  }

  removePickupGroup(time: string, index: number) {
    const groups = this.pickupGroups.get(time);
    if (groups) {
      groups.splice(index, 1);
      if (groups.length === 0) {
        this.pickupGroups.delete(time);
      } else {
        this.pickupGroups.set(time, groups);
      }
    }
  }

  togglePickupInGroup(time: string, groupIndex: number, pickup: string, event: any) {
    const checked = event.target.checked;
    const groups = this.pickupGroups.get(time);
    if (groups && groups[groupIndex]) {
      const group = groups[groupIndex];
      if (checked && !group.includes(pickup)) {
        group.push(pickup);
      } else if (!checked && group.includes(pickup)) {
        groups[groupIndex] = group.filter(p => p !== pickup);
      }
    }
  }

  updateAllowEditBus(event: Passenger) {
    if (this.passengerToBusMap.has(event.confirmationCode)) {
      this.passengerToBusMap.delete(event.confirmationCode)
    }
    else {
      this.passengerToBusMap.set(event.confirmationCode, "Bus Not Chosen")
    }
    console.log(this.passengerToBusMap)
  }

  copyText() {
    const htmlToCopy = document.getElementById('generated-txt')?.innerHTML || '';

    if (htmlToCopy) {
      const blob = new Blob([htmlToCopy], { type: 'text/html' });
      const clipboardItem = new ClipboardItem({ 'text/html': blob });

      navigator.clipboard.write([clipboardItem])
        .then(() => {
          console.log('HTML copied to clipboard successfully!');
        })
        .catch((err) => {
          console.log('Failed to copy HTML to clipboard', err);
        });
    }
  }
  // Driver assignment methods
  onDriverAssigned(event: { busId: string, driverId: string, time: string }) {
    this.busToDriverMap.set(`${event.busId}-${event.time}`, event.driverId);
    console.log('Driver assigned:', event, this.busToDriverMap);
    this.refreshHTMLContent()
  }

  getDriverById(driverId: string): IDriver | undefined {
    return this.drivers.find(d => d.docId === driverId);
  }

  getSelectedDriver(busId: string, time: string): string {
    return this.busToDriverMap.get(`${busId}-${time}`) || '';
  }

  isDriverAssignedElsewhere(driverId: string, currentBusId: string, time: string): boolean {
    // Only check for conflicts within the SAME time slot
    const busesInTime = this.usedBuses.get(time) || [];

    for (const busId of busesInTime) {
      if (busId !== currentBusId) {
        const assignedDriver = this.busToDriverMap.get(`${busId}-${time}`);
        if (assignedDriver === driverId) {
          return true;
        }
      }
    }
    return false;
  }

  // Custom dropdown methods
  toggleDropdown(busId: string, time: string) {
    const key = `${busId}-${time}`;
    const isOpen = this.openDropdowns.get(key) || false;
    // Close all other dropdowns
    this.openDropdowns.clear();
    // Toggle this one
    if (!isOpen) {
      this.openDropdowns.set(key, true);
    }
  }

  selectDriver(busId: string, driverId: string, time: string) {
    this.onDriverAssigned({ busId, driverId, time });
    this.openDropdowns.set(`${busId}-${time}`, false);
  }

  getDriverNameById(driverId: string): string {
    const driver = this.drivers.find(d => d.docId === driverId);
    return driver?.name || '-- Select Driver --';
  }

  // Notes modal methods
  openNotesModal(busId: string, time: string) {
    this.currentNotesBusId = busId;
    this.currentNotesTime = time;
    this.currentNotesKey = `${busId}-${time}`;
    this.editingNotes = this.busToDriverNotesMap.get(this.currentNotesKey) || '';
    this.isNotesModalOpen = true;
  }

  closeNotesModal() {
    this.isNotesModalOpen = false;
    this.currentNotesKey = '';
    this.currentNotesBusId = '';
    this.currentNotesTime = '';
    this.editingNotes = '';
  }

  saveNotes() {
    if (this.editingNotes.trim()) {
      this.busToDriverNotesMap.set(this.currentNotesKey, this.editingNotes.trim());
    } else {
      // Remove notes if empty
      this.busToDriverNotesMap.delete(this.currentNotesKey);
    }
    this.refreshHTMLContent();
    this.closeNotesModal();
  }

  hasNotes(busId: string, time: string): boolean {
    const key = `${busId}-${time}`;
    const notes = this.busToDriverNotesMap.get(key);
    return !!notes && notes.trim().length > 0;
  }

  @HostListener('document:click', ['$event'])
  clickout(event: any) {
    if (!this.eRef.nativeElement.contains(event.target)) {
      this.openDropdowns.clear();
    } else {
      // If the click is inside the component, we still need to check if it's inside a dropdown
      // This is a simplified check. A more robust one checks if the target is within a .custom-dropdown
      // However, since toggleDropdown stops propagation or handles its own logic, we just need to handle clicks *elsewhere* in the component if needed.
      // Actually, the easiest way for "click outside" specific dropdowns is:
      const isDropdownClick = event.target.closest('.custom-dropdown');
      if (!isDropdownClick) {
        this.openDropdowns.clear();
      }
    }
  }

  // Check if all used buses have drivers assigned
  allBusesHaveDrivers(): boolean {
    for (const [time, buses] of this.usedBuses.entries()) {
      for (const busId of buses) {
        if (!this.busToDriverMap.has(`${busId}-${time}`) || !this.busToDriverMap.get(`${busId}-${time}`)) {
          return false;
        }
      }
    }
    return this.usedBuses.size > 0;  // Must have at least some buses
  }

  // Publish assignments to driver portal
  async publishToDriverPortal() {

    // Validate all active time slots have been sorted or attempted sorted
    const allTimes = new Set(this.passengers.map(p => p.startTime));
    for (const time of allTimes) {
      if (!this.successMap.has(time)) {
        this.showToast(`Tour time ${time} has not been sorted. Please sort all tours before publishing.`, 'error');
        return;
      }
    }

    if (!this.allBusesHaveDrivers()) {
      this.showToast(`Please assign a driver to each bus before publishing.`, 'error');
      return;
    }

    // Check for unsorted passengers and confirm
    const unsortedTimes = this.getUnsortedPassengerTimes();
    if (unsortedTimes.length > 0) {
      const formattedTimes = this.getUnsortedTimesFormatted();
      const confirmMessage = `There are unsorted passengers at: ${formattedTimes}.\n\nAre you sure you want to publish assignments?`;

      if (!confirm(confirmMessage)) {
        return; // User cancelled
      }
    }

    // Validate all buses have drivers

    this.isPublishing = true;

    try {
      const assignments: IBusAssignment[] = [];

      for (const [time, buses] of this.usedBuses.entries()) {
        for (const busId of buses) {
          const driverId = this.busToDriverMap.get(`${busId}-${time}`) || '';
          const driver = this.getDriverById(driverId);

          // Get passengers for this bus
          const busPassengers = this.tourBusOrganizer.getBusesByTime(time)
            ?.find(b => b.busId === busId)
            ?.getPassengers() || [];

          const assignedPassengers: IAssignedPassenger[] = busPassengers.map((p: Passenger) => ({
            confirmationCode: p.confirmationCode,
            firstName: p.firstName,
            lastName: p.lastName,
            pickup: this.getPickupAbbreviation(p.pickup),  // Use abbreviation
            fullPickupName: p.pickup,
            numOfPassengers: p.numOfPassengers,
            numOfInfants: p.numOfInfants,
            numOfChildren: p.numOfChildren,
            phoneNumber: p.phoneNumber,
            option: p.option,
            externalBookingReference: p.externalBookingReference,
            status: "not-set"
          }));

          // Find the tour name by matching time
          const tour = this.tours.find(t => t.time === time);

          // Get notes for this driver assignment
          const notes = this.busToDriverNotesMap.get(`${busId}-${time}`);

          // Check if announcement should be included (defaults to true)
          const includeAnnouncement = this.includeAnnouncement.get(time) ?? true;

          assignments.push({
            busId,
            driverId,
            driverName: driver?.name || 'Unknown',
            time,
            tourName: tour?.tourName,
            notes: notes || undefined,  // Only include if exists
            announcement: includeAnnouncement ? this.announcementText : undefined,
            passengers: assignedPassengers,
          });
        }
      }

      const publishedAssignment: IPublishedAssignment = {
        date: this.date,
        publishedAt: new Date().toISOString(),
        assignments,
      };

      // Call the backend API
      const response = await lastValueFrom(this.publishedAssignmentsService.publishAssignment(publishedAssignment));

      console.log('✅ Publish response:', response);

      if (response && (response.success === false || response.error)) {
        throw new Error(response.message || response.error || 'Publish failed');
      }

      console.log('✅ Successfully published to backend!', publishedAssignment);
      this.showToast('Successfully published to Driver Portal!', 'success');
      this.isPublishing = false;
    } catch (e: any) {
      console.error('❌ Publish failed:', e);
      this.showToast(`Failed to publish: ${e.message || 'Unknown error'}`, 'error');
      this.isPublishing = false;
    }
  }

  getInfantsByTime(time: string): number {
    return this.passengers
      .filter(p => p.startTime === time)
      .reduce((sum, p) => sum + (p.numOfInfants ?? 0), 0);
  }

  getBusInfants(bus: Bus): number {
    return bus.getPassengers().reduce((sum: number, p: Passenger) => sum + (p.numOfInfants ?? 0), 0);
  }

  // Helper method to get pickup abbreviation
  getPickupAbbreviation(pickupName: string): string {
    const pickup = this.pickupAbbrevs?.find(p => pickupName.includes(p.name));
    return pickup?.abbreviation || pickupName;
  }
}
