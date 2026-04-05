import { Injectable } from '@angular/core';
import CryptoJS from 'crypto-js';
import { FetchBookingDataOptions } from "../typings/fetch-data-booking-options";
import { Passenger } from "../typings/passenger";
import { IBookingOptions } from "../typings/IBookingOptions";
import { OptionsService } from "./options.service";
import { lastValueFrom } from "rxjs";
import { ExperiencesService } from "./experiences.service";
import { IExperience } from "../typings/ipickup";

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  url: string = "https://api.bokun.io";
  fetchOptions: FetchBookingDataOptions = {
    endpoint: '/booking.json/product-booking-search',
    date: '',  // Will be generated fresh on each API call
    httpMethod: "POST",
  };

  constructor(private optionsService: OptionsService, private experiencesService: ExperiencesService) { }

  generateBokunSignature(date: string, accessKey: string, httpMethod: string, path: string, secretKey: string): string {
    // Concatenate the required values
    const message = `${date}${accessKey}${httpMethod}${path}`;

    // Create HMAC-SHA1 signature
    const hmac = CryptoJS.HmacSHA1(message, secretKey);
    return CryptoJS.enc.Base64.stringify(hmac);
  }

  setKeys(form: any) {
    localStorage.setItem("access", form.accessKey);
    localStorage.setItem("secret", form.secretKey);
    localStorage.setItem("keysTimestamp", Date.now().toString());
    localStorage.removeItem("validated");
  }

  clearKeys() {
    localStorage.clear();
  }

  areKeysExpired(): boolean {
    const timestamp = localStorage.getItem("keysTimestamp");
    if (!timestamp) return true;

    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const keyAge = now - parseInt(timestamp);

    return keyAge > thirtyDaysInMs;
  }

  markValidated() {
    localStorage.setItem("validated", "true");
  }

  fetchBokunData = async (props: FetchBookingDataOptions): Promise<any> => {
    const { endpoint, httpMethod, body } = props;
    const url = `${this.url}${endpoint}`;
    const freshDate = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const headers = {
      'Content-Type': 'application/json',
      'X-Bokun-Date': freshDate,
      'X-Bokun-Signature': this.generateBokunSignature(freshDate, localStorage.getItem("access") || "", httpMethod, endpoint, localStorage.getItem("secret") || ""),
      'X-Bokun-AccessKey': localStorage.getItem("access") || ""
    };

    try {
      const options: RequestInit = {
        method: httpMethod,
        headers
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        console.log("error occurred!");
        throw new Error('Error: Cannot load passengers')
      }

      return await response.json();

    } catch (error) {
      console.error('Failed to fetch Bokun data:', error);
      return null;
    }
  };


  async getPassengersFromProductBookings(date: string, fetchOptions: FetchBookingDataOptions): Promise<Passenger[]> {

    const experiences = await lastValueFrom(this.experiencesService.getExperiences())

    console.log(experiences);

    try {
      const baseBody = {
        ...(fetchOptions.body ?? {}),
        "bookingStatuses": ["CONFIRMED", "ARRIVED", "NO_SHOW", "RESERVED", "NOT_SET", "PENDING"],
        "startDateRange": {
          "from": date,
          "includeLower": true,
          "includeUpper": true,
          "to": date
        }
      };

      const combinedResults: any[] = [];
      let currentPage = 1;

      // Keep requesting additional pages until the API returns no results
      while (true) {
        const paginatedFetchOptions = {
          ...fetchOptions,
          body: {
            ...baseBody,
            "page": currentPage,
          }
        };

        const jsonConfirmedData = await this.fetchBokunData(paginatedFetchOptions);

        if (!jsonConfirmedData || !Array.isArray(jsonConfirmedData.results)) {
          throw new Error("Unexpected response from Bokun API");
        }

        if (!jsonConfirmedData.results.length) {
          break;
        }

        combinedResults.push(...jsonConfirmedData.results);
        currentPage += 1;
      }

      const result = await lastValueFrom(this.optionsService.getOptions()); // Get the options

      console.log(combinedResults)
      return combinedResults
        .filter((val: any) => {
          const experienceFound = experiences.data.find((exp: IExperience) => exp.experienceId === val.productExternalId)
          console.log(experienceFound)
          if (!experienceFound) {
            return val.status !== "CANCELLED"
          }

          return val.status !== "CANCELLED" && experienceFound.isSelected
        })
        .map((val: any) => {
          const productBooking = val.fields;
          const numOfPassengers = val.totalParticipants;
          const pickup = productBooking?.pickupPlace?.title ?? productBooking?.pickupPlaceDescription;
          const hasBoat = val.rateTitle.includes("Boat");
          const hasJourney = val.rateTitle.includes("AND");
          const startTime = productBooking?.startTimeStr;
          const numOfChildren = productBooking?.priceCategoryBookings.reduce((total: number, val: any) => {
            return val?.pricingCategory.ticketCategory === "CHILD" ? total + 1 : total;
          }, 0);
          const numOfInfants = productBooking?.priceCategoryBookings.reduce((total: number, val: any) => {
            return val?.pricingCategory.ticketCategory === "INFANT" ? total + 1 : total;
          }, 0);
          const option = result.data.find((option: IBookingOptions) => productBooking.rateId == option.option)?.abbrev || "Missing Option";

          return {
            confirmationCode: val.confirmationCode,
            externalBookingReference: val.externalBookingReference,
            startTime,
            firstName: val.customer.firstName,
            lastName: val.customer.lastName,
            email: val.customer.email,
            numOfPassengers: numOfPassengers - numOfInfants,
            pickup: pickup == null || pickup == "" ? "NO PICKUP LOCATION ADDED" : pickup,
            hasBoat,
            numOfChildren,
            numOfInfants,
            hasJourney,
            phoneNumber: val.customer.phoneNumber,
            option
          };
        });

    } catch (e) {
      console.error(e)
      throw new Error("Problem with authentication: Please double check your access and secret keys");
    }
  }
}
