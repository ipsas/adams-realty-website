/** Brand copy for item BR-B1 (approved Oct 29, 2026): page titles, meta descriptions and the homepage eyebrow. */
import { BRAND_LEGAL_NAME } from "./brand";
import { site } from "./site";

const { line1, city, state, postalCode } = site.address;

export const HOME_TITLE = `${BRAND_LEGAL_NAME} | ${city}, ${state} Real Estate Brokerage`;

export const HOME_DESCRIPTION = `${BRAND_LEGAL_NAME} is a ${city}, ${state} real estate brokerage with homes, land, farms and lake property around Gainesville and Lake Lanier, from Georgia MLS.`;

export const HOME_EYEBROW = `${BRAND_LEGAL_NAME} · ${city}, ${state}`;

export const CONTACT_TITLE = `Contact ${BRAND_LEGAL_NAME} | ${line1}, ${city}, ${state}`;

export const CONTACT_DESCRIPTION = `Call ${BRAND_LEGAL_NAME} at ${site.phone} or send a message. Our office is at ${line1}, ${city}, ${state} ${postalCode}, with agents across Northeast Georgia.`;
