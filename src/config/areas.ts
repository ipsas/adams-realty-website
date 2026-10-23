/**
 * Area guides (/areas). One entry per town or lake our listings cover, across
 * the Northeast Georgia counties Adams Realty serves.
 *
 * Copy rules — these pages are advertising, so the Fair Housing Act applies:
 * describe places (parks, landmarks, lakes, rivers, historic downtowns,
 * highways), never the people who live there. No claims about schools, crime
 * or "who the area suits". Stick to widely documented, verifiable facts about
 * public places; if a fact can't be checked, leave it out.
 *
 * Listings are matched to an area by neighborhood name (plus `aliases` for the
 * spellings MLS feeds use). An area that *is* a town (Royston, Toccoa, …) also
 * matches on city, which picks up the many rural and small-town listings that
 * carry no subdivision name. Lakes match on neighborhood only. A guide that
 * covers a neighboring town as a section lists it in `cities`, so that town's
 * listings count too. See `src/lib/areas/match.ts`.
 */

export type AreaRegion = "franklin" | "hartwell" | "stephens" | "madison-jackson" | "hall-gwinnett";

export type Area = {
  slug: string;
  name: string;
  /** Municipality shown with the name; also the city matched for town-level areas. */
  city: string;
  /** County names without the word "County". Most towns have one; lakes and some towns span several. */
  counties: string[];
  region: AreaRegion;
  /** 2–3 factual sentences about the place. */
  description: string;
  highlights: string[];
  /** Practical, buyer-relevant context portals leave out (permits, taxes, rules). */
  goodToKnow?: string;
  /** Other spellings of the area seen in MLS data. */
  aliases?: string[];
  /** Other MLS cities whose listings belong to this guide (a town covered as a section, e.g. Hoschton → Braselton). Matched on listings.city, county-scoped like the city itself. */
  cities?: string[];
  center: { lat: number; lng: number };
};

export const areaRegions: { id: AreaRegion; label: string; blurb: string }[] = [
  {
    id: "hall-gwinnett",
    label: "Hall & Gwinnett",
    blurb: "Lake Lanier and the cities around it, from Gainesville to Buford and Dacula.",
  },
  {
    id: "madison-jackson",
    label: "Madison & Jackson Counties",
    blurb:
      "County seats with historic courthouses, rolling farmland, and the I-85 towns of Commerce, Jefferson and Braselton.",
  },
  {
    id: "franklin",
    label: "Franklin County",
    blurb:
      "Home to our Royston office: small towns, farmland and timber along GA 17 and I-85, with Lake Hartwell to the north and east.",
  },
  {
    id: "hartwell",
    label: "Lake Hartwell & Hart County",
    blurb: "Hartwell, the Hart County seat, and the Georgia shoreline of Lake Hartwell.",
  },
  {
    id: "stephens",
    label: "Stephens County",
    blurb: "Toccoa and Martin, in the Blue Ridge foothills near the Tugaloo River.",
  },
];

export const areas: Area[] = [
  // ── Hall & Gwinnett ────────────────────────────────────────────────────────
  {
    slug: "gainesville",
    name: "Gainesville",
    city: "Gainesville",
    counties: ["Hall"],
    region: "hall-gwinnett",
    description:
      "Gainesville is the Hall County seat, on the eastern shore of Lake Lanier. Lake Lanier Olympic Park hosted the rowing and canoe/kayak events of the 1996 Olympic Games, and the historic downtown square is lined with shops and restaurants.",
    highlights: [
      "Lake Lanier Olympic Park",
      "The historic downtown square",
      "Brenau University",
      "The Poultry Capital of the World monument",
    ],
    center: { lat: 34.2979, lng: -83.8241 },
  },
  {
    slug: "oakwood",
    name: "Oakwood",
    city: "Oakwood",
    counties: ["Hall"],
    region: "hall-gwinnett",
    description:
      "Oakwood is a Hall County city between Gainesville and Flowery Branch, with I-985 Exits 16 and 17 on its southeastern side. Founded in 1873 as O'Dell's Crossing and renamed Oakwood in 1896, it's home to the University of North Georgia's Gainesville Campus.",
    highlights: [
      "The University of North Georgia's Gainesville Campus, with the Ed Cabell Theater and Roy C. Moore Art Gallery",
      "I-985 at Exits 16 and 17, about 48 miles from downtown Atlanta",
      "GA 53 southeast toward Hoschton and Braselton",
      "Incorporated by the Georgia General Assembly in 1903",
    ],
    goodToKnow:
      "Oakwood shares ZIP codes with its neighbors, so a home inside the city can carry a Gainesville or Flowery Branch mailing address, and a home outside it can carry an Oakwood one. Check whether an address is inside the city limits before counting on city services or city property taxes.",
    center: { lat: 34.2511, lng: -83.8611 },
  },
  {
    slug: "flowery-branch",
    name: "Flowery Branch",
    city: "Flowery Branch",
    counties: ["Hall"],
    region: "hall-gwinnett",
    description:
      "Flowery Branch is a Hall County city on the shore of Lake Lanier, established in 1874 along the new Air-Line railroad. It's home to the Atlanta Falcons' headquarters and training facility, and its historic train depot is now a museum.",
    highlights: [
      "The historic train depot museum and caboose",
      "The Atlanta Falcons' headquarters and training facility",
      "Lake Lanier parks and marinas nearby",
      "I-985 access",
    ],
    center: { lat: 34.1851, lng: -83.9252 },
  },
  {
    slug: "lake-lanier",
    name: "Lake Lanier",
    city: "Gainesville",
    counties: ["Hall", "Forsyth", "Gwinnett", "Dawson", "Lumpkin"],
    region: "hall-gwinnett",
    description:
      "Lake Sidney Lanier is an Army Corps of Engineers reservoir on the Chattahoochee River, formed by Buford Dam in the 1950s. With hundreds of miles of shoreline, it's the region's big lake for boating and waterfront living, from Lake Lanier Islands to quiet coves in Hall County.",
    highlights: [
      "Marinas, boat ramps and swimming beaches in Corps of Engineers parks",
      "Lake Lanier Islands resort",
      "Buford Dam and Lower Pool Park",
      "Lake Lanier Olympic Park in Gainesville",
    ],
    goodToKnow:
      "Lanier's shoreline is federal land managed by the Army Corps of Engineers. A private dock needs a Corps permit, and not every lakefront lot qualifies, so ask us about a home's dock status before you fall for the view.",
    aliases: ["Lanier", "Lake Sidney Lanier"],
    center: { lat: 34.19, lng: -83.98 },
  },
  {
    slug: "buford",
    name: "Buford",
    city: "Buford",
    counties: ["Gwinnett", "Hall"],
    region: "hall-gwinnett",
    description:
      "Buford grew up around the railroad in the 1870s and was long home to the Bona Allen Company, whose leather goods sold nationwide. Its former tannery buildings now hold the Tannery Row artist studios downtown, and the Mall of Georgia and Lake Lanier Islands are a short drive away.",
    highlights: [
      "Tannery Row artist studios and historic downtown Buford",
      "The Mall of Georgia",
      "Lake Lanier Islands resort",
      "The historic Bona Allen Mansion",
    ],
    center: { lat: 34.1207, lng: -84.0044 },
  },
  {
    slug: "sugar-hill",
    name: "Sugar Hill",
    city: "Sugar Hill",
    counties: ["Gwinnett"],
    region: "hall-gwinnett",
    description:
      "Sugar Hill is a city in northern Gwinnett County, between Buford and Suwanee and close to Lake Lanier. Chartered as a town in 1939, it's named for a local story of a wagonload of sugar spilled on a hill, and its downtown on West Broad Street is home to The Bowl amphitheater and the Art Deco Eagle Theatre.",
    highlights: [
      "The Bowl at Sugar Hill, an outdoor amphitheater downtown",
      "The Eagle Theatre and the E Center on West Broad Street",
      "Gary Pirkle Park: 67 acres along Richland Creek, with paved, lighted walking trails",
      "Sugar Hill Golf Club, open since 1992",
      "GA 20 to I-985 in Buford, about 19 miles from Gainesville",
    ],
    goodToKnow:
      "The City of Sugar Hill runs its own natural gas utility. Ask whether a home is in the city's gas service area, since that decides who you set up gas service with.",
    center: { lat: 34.086, lng: -84.034 },
  },
  {
    slug: "dacula",
    name: "Dacula",
    city: "Dacula",
    counties: ["Gwinnett"],
    region: "hall-gwinnett",
    description:
      "Dacula is a city in eastern Gwinnett County, with Winder Highway (U.S. 29 Business) as its main road. Nearby, the Elisha Winn House, built in 1812, served as Gwinnett's first courthouse and is the county's oldest surviving building.",
    highlights: [
      "Little Mulberry Park: 890 acres of trails, pastures and two lakes",
      "The Elisha Winn House (1812)",
      "U.S. 29 Business through the center of town",
    ],
    center: { lat: 33.9887, lng: -83.898 },
  },

  // ── Madison & Jackson Counties ─────────────────────────────────────────────
  {
    slug: "danielsville",
    name: "Danielsville",
    city: "Danielsville",
    counties: ["Madison"],
    region: "madison-jackson",
    description:
      "Danielsville is the Madison County seat, and its town square is centered on the 1901 Madison County Courthouse. Crawford Long, the first physician to use ether as an anesthetic in surgery, was born here in 1815.",
    highlights: [
      "The 1901 Madison County Courthouse, listed on the National Register of Historic Places",
      "Crawford W. Long's birthplace",
      "U.S. 29 toward Athens and Royston",
    ],
    center: { lat: 34.1243, lng: -83.2213 },
  },
  {
    slug: "comer",
    name: "Comer",
    city: "Comer",
    counties: ["Madison"],
    region: "madison-jackson",
    description:
      "Comer is a small city in eastern Madison County. Nearby Watson Mill Bridge State Park is named for its 229-foot covered bridge, built in 1885 across the South Fork of the Broad River and the longest original-site covered bridge in Georgia.",
    highlights: [
      "Watson Mill Bridge State Park and its 1885 covered bridge",
      "Trails along the South Fork of the Broad River",
      "GA 72 toward Athens and Elberton",
    ],
    center: { lat: 34.0637, lng: -83.1254 },
  },
  {
    slug: "commerce",
    name: "Commerce",
    city: "Commerce",
    counties: ["Jackson"],
    region: "madison-jackson",
    description:
      "Commerce is a Jackson County city on I-85 and U.S. 441, founded in the early 1800s as Harmony Grove and renamed in 1909. Its historic downtown sits on one side of the interstate, with Tanger Outlets across it at Banks Crossing.",
    highlights: [
      "Tanger Outlets at Banks Crossing, I-85 Exit 149",
      "Historic downtown Commerce",
      "Atlanta Dragway nearby",
    ],
    center: { lat: 34.204, lng: -83.4571 },
  },
  {
    slug: "jefferson",
    name: "Jefferson",
    city: "Jefferson",
    counties: ["Jackson"],
    region: "madison-jackson",
    description:
      "Jefferson is the Jackson County seat. Its 1879 courthouse, one of the first built in Georgia after the Civil War, is now a museum and visitor center, and the Crawford W. Long Museum downtown tells the story of the doctor who first used ether as an anesthetic here in 1842.",
    highlights: [
      "The historic 1879 Jackson County Courthouse",
      "The Crawford W. Long Museum",
      "I-85 access via U.S. 129",
    ],
    center: { lat: 34.1171, lng: -83.5724 },
  },
  {
    slug: "braselton",
    name: "Braselton",
    city: "Braselton",
    counties: ["Jackson", "Gwinnett", "Hall", "Barrow"],
    region: "madison-jackson",
    description:
      "Braselton, incorporated in 1916, is a town of about 34 square miles that spreads across Jackson, Gwinnett, Hall and Barrow counties along I-85. It's home to Château Élan Winery & Resort, and Michelin Raceway Road Atlanta, home of the Petit Le Mans endurance race, is just north of town. Next door, the small city of Hoschton grew up around its 1883 railroad depot, which still stands on GA 53 and is listed on the National Register of Historic Places.",
    highlights: [
      "Château Élan Winery & Resort",
      "Michelin Raceway Road Atlanta, a 2.54-mile road course",
      "Historic downtown Braselton",
      "The 1883 Hoschton Depot on GA 53, now a community landmark",
      "GA 53 through Hoschton, northwest to Oakwood and I-985",
      "I-85 at Exits 126 and 129",
    ],
    goodToKnow:
      "The Hoschton ZIP code, 30548, reaches well past the City of Hoschton into parts of Jackson, Barrow, Hall and Gwinnett counties, including part of Braselton. A Hoschton mailing address doesn't tell you the city or county, so check both for a specific home; they decide property taxes and local services.",
    aliases: ["Hoschton"],
    cities: ["Hoschton"],
    center: { lat: 34.1093, lng: -83.7627 },
  },

  // ── Franklin County ────────────────────────────────────────────────────────
  {
    slug: "royston",
    name: "Royston",
    city: "Royston",
    counties: ["Franklin", "Hart", "Madison"],
    region: "franklin",
    description:
      "Royston is a small city where Franklin, Hart and Madison counties meet, at the crossroads of U.S. 29 and GA 8. It was the hometown of baseball Hall of Famer Ty Cobb, and the Ty Cobb Museum on Cook Street tells his story.",
    highlights: [
      "The Ty Cobb Museum, open since 1998",
      "Victoria Bryant State Park, with an 18-hole golf course, campground and trails",
      "U.S. 29 toward Hartwell and Athens, with GA 17 skirting the city",
      "Adams Realty, Inc., at 69 Mill Street",
    ],
    center: { lat: 34.2871, lng: -83.1101 },
  },
  {
    slug: "franklin-springs",
    name: "Franklin Springs",
    city: "Franklin Springs",
    counties: ["Franklin"],
    region: "franklin",
    description:
      "Franklin Springs is a small city in southern Franklin County, just west of Royston. It's home to Emmanuel University, founded here in 1919 as the Franklin Springs Institute, and 502-acre Victoria Bryant State Park is close by.",
    highlights: [
      "Emmanuel University's campus",
      "Victoria Bryant State Park and its Highland Walk golf course",
      "A few minutes from Royston and U.S. 29",
    ],
    center: { lat: 34.2848, lng: -83.1435 },
  },
  {
    slug: "canon",
    name: "Canon",
    city: "Canon",
    counties: ["Franklin", "Hart"],
    region: "franklin",
    description:
      "Canon is a small city on GA 17 that straddles the Franklin–Hart county line. Known for years as West Bowersville, it was chartered under its current name in 1902.",
    highlights: [
      "Chartered as Canon in 1902",
      "GA 17 north to Lavonia and I-85, south to Royston",
      "A short drive to Victoria Bryant State Park",
    ],
    center: { lat: 34.3462, lng: -83.1107 },
  },
  {
    slug: "lavonia",
    name: "Lavonia",
    city: "Lavonia",
    counties: ["Franklin", "Hart"],
    region: "franklin",
    description:
      "Lavonia sits on I-85 at Exit 173 in northern Franklin County, near the South Carolina line. GA 17 runs through its downtown, and Tugaloo State Park, on a wooded peninsula in Lake Hartwell, is a short drive away.",
    highlights: [
      "Tugaloo State Park on Lake Hartwell",
      "I-85 at Exit 173",
      "Downtown Lavonia along GA 17",
    ],
    center: { lat: 34.4359, lng: -83.1068 },
  },
  {
    slug: "carnesville",
    name: "Carnesville",
    city: "Carnesville",
    counties: ["Franklin"],
    region: "franklin",
    description:
      "Carnesville has been the Franklin County seat since 1806. Its 1906 Neoclassical courthouse, listed on the National Register of Historic Places, anchors a small downtown, and I-85 passes just northwest of town.",
    highlights: [
      "The 1906 Franklin County Courthouse",
      "I-85 access at Exits 164 and 166",
      "GA 59, GA 106 and GA 145 through town",
      "Pasture, timber and farmland in every direction",
    ],
    center: { lat: 34.3701, lng: -83.2352 },
  },

  // ── Lake Hartwell & Hart County ────────────────────────────────────────────
  {
    slug: "hartwell",
    name: "Hartwell",
    city: "Hartwell",
    counties: ["Hart"],
    region: "hartwell",
    description:
      "Hartwell is the Hart County seat, named, like the county, for Revolutionary War heroine Nancy Hart. Its downtown commercial historic district holds buildings from about 1879 to 1925, and Lake Hartwell's shoreline reaches the edge of town.",
    highlights: [
      "The Hartwell Commercial Historic District",
      "Hartwell Lakeside Park, formerly Hart State Park, on Lake Hartwell",
      "The Center of the World monument on U.S. 29, about three miles south of town",
      "Hart County, the only Georgia county named for a woman",
    ],
    center: { lat: 34.3529, lng: -82.9321 },
  },
  {
    slug: "lake-hartwell",
    name: "Lake Hartwell",
    city: "Hartwell",
    counties: ["Hart", "Franklin", "Stephens"],
    region: "hartwell",
    description:
      "Lake Hartwell is a 56,000-acre Army Corps of Engineers reservoir on the Georgia–South Carolina line, created by Hartwell Dam on the Savannah River and completed in 1962. Its 962 miles of shoreline take in the Savannah, Tugaloo and Seneca rivers, and on the Georgia side, Hart, Franklin and Stephens counties all have lakefront.",
    highlights: [
      "Tugaloo State Park on a wooded peninsula",
      "Hartwell Lakeside Park in Hartwell",
      "Corps of Engineers parks with boat ramps, beaches and campgrounds",
      "Hartwell Dam, seven miles below where the Tugaloo and Seneca rivers meet",
    ],
    goodToKnow:
      "Lake Hartwell's shoreline is federal land managed by the Army Corps of Engineers. Private docks are allowed only where the Corps' Shoreline Management Plan marks the shoreline for limited development, and each needs a shoreline use permit, so ask us about a home's dock status before you fall for the view.",
    aliases: ["Hartwell Lake"],
    center: { lat: 34.4, lng: -82.9 },
  },

  // ── Stephens County ────────────────────────────────────────────────────────
  {
    slug: "toccoa",
    name: "Toccoa",
    city: "Toccoa",
    counties: ["Stephens"],
    region: "stephens",
    description:
      "Toccoa is the Stephens County seat, in the foothills of the Blue Ridge. Toccoa Falls, a 186-foot waterfall on the campus of the University of Toccoa Falls, is one of the tallest free-falling waterfalls east of the Mississippi. During World War II, paratroopers trained at Camp Toccoa at the foot of Currahee Mountain.",
    highlights: [
      "Toccoa Falls, 186 feet high",
      "The Currahee Military Museum in the historic train depot",
      "Currahee Mountain, where Camp Toccoa's paratroopers trained",
      "Travelers Rest State Historic Site, an early-1800s stagecoach inn near the Tugaloo River",
    ],
    center: { lat: 34.5773, lng: -83.3324 },
  },
  {
    slug: "martin",
    name: "Martin",
    city: "Martin",
    counties: ["Stephens"],
    region: "stephens",
    description:
      "Martin is a small town in eastern Stephens County on GA 17, about 11 miles southeast of Toccoa and 6 miles northwest of Lavonia. Lake Hartwell and Tugaloo State Park are a short drive east.",
    highlights: [
      "GA 17 to Toccoa and Lavonia",
      "I-85 about 6 miles away at Lavonia",
      "Lake Hartwell and Tugaloo State Park nearby",
    ],
    center: { lat: 34.4868, lng: -83.1851 },
  },
];

/** Case/punctuation-insensitive key: "Franklin-Springs" and "franklin springs" match. */
export function normalizeAreaName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const byKey = new Map<string, Area>();
for (const a of areas) {
  for (const key of [a.slug, a.name, ...(a.aliases ?? []), ...(a.cities ?? [])]) {
    byKey.set(normalizeAreaName(key), a);
  }
}

/** Finds an area by slug, name or alias ("lake-hartwell", "Hartwell Lake", "FLOWERY BRANCH"). */
export function findArea(nameOrSlug: string | null | undefined): Area | undefined {
  if (!nameOrSlug) return undefined;
  return byKey.get(normalizeAreaName(nameOrSlug));
}

/** The town-level guide for this very city ("Gainesville" → gainesville); lakes and section towns (Hoschton) have none. */
export function townGuide(city: string): Area | undefined {
  const a = findArea(city);
  if (!a) return undefined;
  const c = normalizeAreaName(a.city);
  return c === normalizeAreaName(city) && c === normalizeAreaName(a.name) ? a : undefined;
}

/** "Franklin County" / "Hart, Franklin and Stephens counties". */
export function countyLabel(area: Pick<Area, "counties">): string {
  const c = area.counties;
  if (c.length === 1) return `${c[0]} County`;
  return `${c.slice(0, -1).join(", ")} and ${c[c.length - 1]} counties`;
}

export function areaHref(area: Pick<Area, "slug">): string {
  return `/areas/${area.slug}`;
}
