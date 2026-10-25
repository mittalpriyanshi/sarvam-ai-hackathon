import type { TicketResult } from './types';

// Clearly-labelled SAMPLE data shown in demo mode. Not produced by any API call.
export const SAMPLE_TICKET_TEXT = `IRCTC ELECTRONIC RESERVATION SLIP (ERS) — SAMPLE
PNR: 2456781903   Train No./Name: 12560 / SHIV GANGA EXP
Class: AC 3 TIER (3A)   Quota: GENERAL (GN)
From: NEW DELHI (NDLS)   To: BANARAS (BSBS)
Boarding At: NEW DELHI (NDLS)   Departure*: 20:05 14-Nov-2026
Arrival*: 08:15 15-Nov-2026
Passenger: A K YADAV   Age 21   M   Booking Status: CNF/B4/23/LOWER   Current Status: CNF/B4/23/LOWER
Total Fare: ₹1,285.00
* Departure/arrival times are subject to change.
Passengers travelling on e-ticket must carry original ID proof in the train.
Chart is prepared about 4 hours before scheduled departure.
यात्रा के दौरान मूल पहचान पत्र साथ रखें।`;

export const SAMPLE_RESULT: TicketResult = {
  success: true,
  mode: 'sample',
  input: 'text',
  ticketType: 'train',
  sourceLanguage: 'English, Hindi',
  targetLanguage: 'English',
  sourceText: SAMPLE_TICKET_TEXT,
  fields: {
    travellerName: { value: 'A K YADAV', note: 'Male, 21' },
    origin: { value: 'NEW DELHI (NDLS)', note: 'Board here — NDLS is the station code.' },
    destination: { value: 'BANARAS (BSBS)', note: 'Banaras station, not Varanasi Junction (BSB).' },
    departureDate: { value: '14-Nov-2026', note: null },
    departureTime: { value: '20:05', note: '8:05 PM' },
    arrivalDate: { value: '15-Nov-2026', note: 'Next day' },
    arrivalTime: { value: '08:15', note: '8:15 AM' },
    trainOrBusNumber: { value: '12560 / SHIV GANGA EXP', note: null },
    ticketClass: { value: 'AC 3 TIER (3A)', note: 'Air-conditioned sleeper, 3 berths per side.' },
    seat: { value: '23/LOWER', note: 'Berth 23, lower berth.' },
    coach: { value: 'B4', note: 'Look for “B4” on the coach board.' },
    platform: { value: null, note: null },
    bookingReference: { value: '2456781903', note: 'Your PNR — use it to check status.' },
    bookingStatus: { value: 'CNF/B4/23/LOWER', note: 'Confirmed seat.' },
    fare: { value: '₹1,285.00', note: null },
  },
  abbreviations: [
    { term: 'PNR', meaning: 'Passenger Name Record — your booking ID.' },
    { term: 'CNF', meaning: 'Confirmed — you have a seat.' },
    { term: '3A', meaning: 'AC 3-tier sleeper class.' },
    { term: 'GN', meaning: 'General quota (regular booking).' },
    { term: 'ERS', meaning: 'Electronic Reservation Slip — this e-ticket.' },
  ],
  importantInstructions: [
    'Carry your original ID proof on the train when travelling on an e-ticket.',
    'Departure and arrival times can change.',
    'The reservation chart is prepared about 4 hours before departure.',
  ],
  checklist: [
    { item: 'Pack an original photo ID (Aadhaar, PAN, passport, etc.).', basis: 'ticket' },
    { item: 'Re-check the departure time on the day of travel.', basis: 'ticket' },
    { item: 'Check the platform number at NDLS before leaving — it is not printed on the ticket.', basis: 'suggestion' },
    { item: 'Find coach B4 and lower berth 23.', basis: 'ticket' },
    { item: 'Reach the station 30 minutes early.', basis: 'suggestion' },
  ],
  translation: [
    { original: 'यात्रा के दौरान मूल पहचान पत्र साथ रखें।', translated: 'Keep your original ID card with you during the journey.' },
    { original: 'Booking Status: CNF/B4/23/LOWER', translated: 'Your seat is confirmed: coach B4, berth 23, lower.' },
    { original: 'Quota: GENERAL (GN)', translated: 'Booked under the regular (general) quota.' },
  ],
  uncertainFields: ['platform'],
  summary:
    'Train 12560 Shiv Ganga Express from New Delhi to Banaras, leaving 14 Nov 2026 at 8:05 PM and arriving next morning at 8:15 AM. Your seat is confirmed in coach B4, lower berth 23 (AC 3-tier). Carry original ID; the platform is not printed, so check it at the station.',
};
