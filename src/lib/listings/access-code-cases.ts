// Access-code masking cases, shared by the unit test and the Postgres check in keyword.db.test.ts.

/** Remarks that mention a code word but carry no code: shown byte for byte. */
export const NO_CODE = [
  "dining combo, 2-car garage",
  "Living/dining combo with 3 bedrooms",
  "washer/dryer combo",
  "1 year old roof",
  "2nd floor laundry",
  "24 hr notice required",
  "showing instructions: call listing agent, 24 hr notice",
  "lockbox on front door",
  "Supra lockbox on side door",
  "keypad entry",
  "gated community",
  "alarm system",
  "Built in 2004, 3 car garage",
  "Lot 12, Unit 4B",
  "HOA $150/mo",
  "Kitchen/dining combo: 2 windows",
  "Keypad 2nd door",
  "Codes compliant, 1998 build",
];

/** A code phrase and its code; `code` must not survive in the masked text. */
export const WITH_CODE: [string, string][] = [
  ["lockbox code 1234", "1234"],
  ["Lockbox combo: 4521", "4521"],
  ["combo is 9876", "9876"],
  ["combo: 12-34", "12-34"],
  ["alarm code is 5678", "5678"],
  ["alarm 1234", "1234"],
  ["gate code #4521", "4521"],
  ["gatecode 4521#", "4521"],
  ["garage code 5678", "5678"],
  ["door code: 2468", "2468"],
  ["access code 1357", "1357"],
  ["keypad 1234", "1234"],
  ["code is 8642", "8642"],
  ["code: 7777", "7777"],
  ["Supra #A12B", "A12B"],
  ["Supra box 12345", "12345"],
  ["CBS code 99887", "99887"],
  ["lock box 1 2 3 4", "1 2 3 4"],
  ["key under the mat", "mat"],
];
