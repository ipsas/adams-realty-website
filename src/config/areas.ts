/**
 * Neighborhood guides (/areas). One entry per area our listings cover.
 *
 * Copy rules — these pages are advertising, so the Fair Housing Act applies:
 * describe places (parks, landmarks, trails, housing styles, transit), never
 * the people who live there. No claims about schools, crime or "who the area
 * suits". Stick to widely documented, verifiable facts about public places.
 *
 * Listings are matched to an area by neighborhood name (plus `aliases` for the
 * spellings MLS feeds use). An area that *is* a city (Decatur, Roswell, …) also
 * matches on city, which picks up listings the feed didn't tag with a
 * neighborhood. See `src/lib/areas/match.ts`.
 */

export type AreaRegion = "intown" | "north" | "west-south" | "lake";

export type Area = {
  slug: string;
  name: string;
  /** Municipality shown with the name; also the city matched for city-level areas. */
  city: string;
  /** County names without the word "County". Most areas have one; Lake Lanier touches five. */
  counties: string[];
  region: AreaRegion;
  /** 2–3 factual sentences about the place. */
  description: string;
  highlights: string[];
  /** Practical, buyer-relevant context portals leave out (permits, taxes, rules). */
  goodToKnow?: string;
  /** Other spellings of the neighborhood seen in MLS data. */
  aliases?: string[];
  center: { lat: number; lng: number };
};

export const areaRegions: { id: AreaRegion; label: string; blurb: string }[] = [
  {
    id: "intown",
    label: "Intown Atlanta",
    blurb:
      "Historic city neighborhoods and Decatur next door, close to the BeltLine, MARTA and Atlanta's big parks.",
  },
  {
    id: "north",
    label: "North suburbs",
    blurb: "Cities along GA-400 and the Chattahoochee River, from Brookhaven to Johns Creek.",
  },
  {
    id: "west-south",
    label: "West & South",
    blurb: "Cobb County's historic town centers, plus Peachtree City's path-connected villages.",
  },
  {
    id: "lake",
    label: "Lake Lanier",
    blurb: "Waterfront and lake-access homes on metro Atlanta's big reservoir.",
  },
];

export const areas: Area[] = [
  // ── Intown Atlanta ─────────────────────────────────────────────────────────
  {
    slug: "midtown",
    name: "Midtown",
    city: "Atlanta",
    counties: ["Fulton"],
    region: "intown",
    description:
      "Midtown is Atlanta's arts and business district, stretching along Peachtree Street between Downtown and Buckhead. Piedmont Park, the Atlanta Botanical Garden and the Woodruff Arts Center anchor the neighborhood, and homes range from high-rise condos to early-1900s houses on tree-lined side streets.",
    highlights: [
      "Piedmont Park and the Atlanta Botanical Garden",
      "Woodruff Arts Center, home of the High Museum of Art and the Atlanta Symphony Orchestra",
      "The Fox Theatre on Peachtree Street",
      "Three MARTA rail stations: North Avenue, Midtown and Arts Center",
    ],
    center: { lat: 33.7838, lng: -84.383 },
  },
  {
    slug: "buckhead",
    name: "Buckhead",
    city: "Atlanta",
    counties: ["Fulton"],
    region: "intown",
    description:
      "Buckhead covers much of north Atlanta, from the high-rises along Peachtree Road to wooded residential streets off West Paces Ferry Road. It's known for shopping at Lenox Square and Phipps Plaza, the Atlanta History Center, and Chastain Park.",
    highlights: [
      "Atlanta History Center and the historic Swan House",
      "Lenox Square and Phipps Plaza",
      "Chastain Park, with an amphitheater, walking trail and public golf course",
      "Buckhead (Red Line) and Lenox (Gold Line) MARTA stations",
    ],
    center: { lat: 33.843, lng: -84.378 },
  },
  {
    slug: "virginia-highland",
    name: "Virginia-Highland",
    city: "Atlanta",
    counties: ["Fulton"],
    region: "intown",
    description:
      "Virginia-Highland takes its name from the intersection of Virginia and North Highland Avenues, one of several small commercial pockets lined with restaurants and shops. Its streets are filled with early-20th-century bungalows and cottages, with Piedmont Park and the BeltLine Eastside Trail a short walk west.",
    highlights: [
      "Restaurants and shops clustered around Virginia Ave and N Highland Ave",
      "John Howell Park",
      "Craftsman bungalows from the 1910s and 1920s",
      "Virginia-Highland Summerfest each summer",
    ],
    aliases: ["Virginia Highland", "Virginia Highlands"],
    center: { lat: 33.781, lng: -84.353 },
  },
  {
    slug: "inman-park",
    name: "Inman Park",
    city: "Atlanta",
    counties: ["Fulton"],
    region: "intown",
    description:
      "Inman Park was Atlanta's first planned suburb, laid out in the late 1880s and linked to downtown by the city's first electric streetcar line. Today it's known for restored Victorian homes, winding streets and parks, and quick access to the BeltLine Eastside Trail and Krog Street Market.",
    highlights: [
      "Victorian-era homes and Springvale Park",
      "Inman Park Festival and Tour of Homes each spring",
      "BeltLine Eastside Trail and Krog Street Market",
      "Inman Park/Reynoldstown MARTA station",
    ],
    goodToKnow:
      "Inman Park is a City of Atlanta historic district, so exterior changes and additions go through the Urban Design Commission's review. Ask us what's allowed before you plan a renovation.",
    center: { lat: 33.758, lng: -84.352 },
  },
  {
    slug: "old-fourth-ward",
    name: "Old Fourth Ward",
    city: "Atlanta",
    counties: ["Fulton"],
    region: "intown",
    description:
      "Old Fourth Ward sits just east of Downtown and includes the Sweet Auburn historic district and the Martin Luther King Jr. National Historical Park. The BeltLine Eastside Trail runs through it, connecting Historic Fourth Ward Park and Ponce City Market with historic homes, townhomes and newer lofts.",
    highlights: [
      "Martin Luther King Jr. National Historical Park, including his birth home and Ebenezer Baptist Church",
      "Historic Fourth Ward Park, with its stormwater pond, playground and skatepark",
      "Ponce City Market in the former Sears, Roebuck building",
      "BeltLine Eastside Trail",
    ],
    aliases: ["Old 4th Ward", "O4W"],
    center: { lat: 33.764, lng: -84.372 },
  },
  {
    slug: "grant-park",
    name: "Grant Park",
    city: "Atlanta",
    counties: ["Fulton"],
    region: "intown",
    description:
      "Grant Park is named for Atlanta's oldest city park, home to Zoo Atlanta, and has one of the city's largest collections of Victorian homes and Craftsman bungalows. Historic Oakland Cemetery lies just to the north, and the neighborhood hosts the Summer Shade Festival each year.",
    highlights: [
      "Grant Park, Atlanta's oldest city park",
      "Zoo Atlanta",
      "Victorian homes and Craftsman bungalows",
      "Historic Oakland Cemetery nearby",
    ],
    goodToKnow:
      "Grant Park is a City of Atlanta historic district, so exterior changes and additions go through the Urban Design Commission's review. Ask us what's allowed before you plan a renovation.",
    center: { lat: 33.737, lng: -84.37 },
  },
  {
    slug: "kirkwood",
    name: "Kirkwood",
    city: "Atlanta",
    counties: ["DeKalb"],
    region: "intown",
    description:
      "Kirkwood is an east Atlanta neighborhood of early-20th-century bungalows and cottages that was once its own town. Bessie Branham Park, a small business district and the redeveloped Pullman Yard give it a village feel, with Decatur a short drive away.",
    highlights: [
      "Bessie Branham Park",
      "Pullman Yard, a historic rail yard turned arts and events venue",
      "A compact business district along Hosea L. Williams Drive",
      "East Lake MARTA station nearby",
    ],
    center: { lat: 33.754, lng: -84.319 },
  },
  {
    slug: "east-atlanta",
    name: "East Atlanta",
    city: "Atlanta",
    counties: ["DeKalb"],
    region: "intown",
    description:
      "East Atlanta centers on East Atlanta Village, a compact business district at Flat Shoals and Glenwood Avenues known for independent restaurants, bars and live music. Surrounding streets mix bungalows, ranches and newer infill homes, and parts of the 1864 Battle of Atlanta were fought here.",
    highlights: [
      "East Atlanta Village restaurants and music venues",
      "Brownwood Park",
      "The annual East Atlanta Strut festival",
      "Battle of Atlanta historical markers",
    ],
    aliases: ["East Atlanta Village", "EAV"],
    center: { lat: 33.74, lng: -84.344 },
  },
  {
    slug: "candler-park",
    name: "Candler Park",
    city: "Atlanta",
    counties: ["DeKalb"],
    region: "intown",
    description:
      "Candler Park is named for its park, land donated by Coca-Cola magnate Asa Candler, which includes a nine-hole public golf course, a pool and playing fields. Craftsman bungalows fill its streets, and the McLendon Avenue shops and Freedom Park trail are close at hand.",
    highlights: [
      "Candler Park's golf course, pool and fields",
      "Shops and restaurants along McLendon Avenue",
      "Freedom Park and its multi-use trail",
      "Edgewood/Candler Park MARTA station",
    ],
    center: { lat: 33.765, lng: -84.338 },
  },
  {
    slug: "decatur",
    name: "Decatur",
    city: "Decatur",
    counties: ["DeKalb"],
    region: "intown",
    description:
      "Decatur is an independent city just east of Atlanta and the seat of DeKalb County. Its walkable downtown square surrounds the Historic DeKalb Courthouse, with restaurants, shops, a MARTA station and a busy calendar of festivals.",
    highlights: [
      "Downtown square and the Historic DeKalb Courthouse",
      "Decatur MARTA station on the Blue Line",
      "Agnes Scott College's historic campus",
      "Oakhurst's neighborhood restaurants and shops",
    ],
    goodToKnow:
      "Homes inside Decatur's city limits pay City of Decatur property taxes on top of DeKalb County's, and many homes with a Decatur mailing address are actually in unincorporated DeKalb. We'll confirm which side of the line a home is on.",
    center: { lat: 33.7748, lng: -84.2963 },
  },

  // ── North suburbs ──────────────────────────────────────────────────────────
  {
    slug: "brookhaven",
    name: "Brookhaven",
    city: "Brookhaven",
    counties: ["DeKalb"],
    region: "north",
    description:
      "Brookhaven, incorporated as a city in 2012, sits just north of Buckhead along Peachtree Road. It's home to Oglethorpe University, Murphey Candler Park and Blackburn Park, with homes ranging from mid-century ranches to new construction and townhomes near the MARTA station.",
    highlights: [
      "Murphey Candler Park and its lake",
      "Blackburn Park and its tennis center",
      "Oglethorpe University",
      "Brookhaven/Oglethorpe MARTA station",
    ],
    center: { lat: 33.8651, lng: -84.3366 },
  },
  {
    slug: "sandy-springs",
    name: "Sandy Springs",
    city: "Sandy Springs",
    counties: ["Fulton"],
    region: "north",
    description:
      "Sandy Springs, incorporated as a city in 2005, stretches north from Atlanta to the Chattahoochee River along GA-400. City Springs, its civic center, hosts a performing arts center and year-round events, and the river's national recreation area offers trails and paddling.",
    highlights: [
      "City Springs and the Sandy Springs Performing Arts Center",
      "Chattahoochee River National Recreation Area trails at Island Ford",
      "Morgan Falls Overlook Park",
      "Heritage Sandy Springs and the city's namesake spring",
    ],
    center: { lat: 33.9304, lng: -84.3733 },
  },
  {
    slug: "roswell",
    name: "Roswell",
    city: "Roswell",
    counties: ["Fulton"],
    region: "north",
    description:
      "Roswell is one of metro Atlanta's oldest towns, founded in the 1830s around a cotton mill on Vickery Creek. Its historic district includes antebellum homes such as Bulloch Hall and Barrington Hall, and Canton Street is lined with restaurants and shops.",
    highlights: [
      "Canton Street's restaurants and shops",
      "Bulloch Hall and Barrington Hall",
      "Vickery Creek trails and the Roswell Mill ruins",
      "Chattahoochee Nature Center and Riverside Park",
    ],
    center: { lat: 34.0232, lng: -84.3616 },
  },
  {
    slug: "alpharetta",
    name: "Alpharetta",
    city: "Alpharetta",
    counties: ["Fulton"],
    region: "north",
    description:
      "Alpharetta is a north Fulton city on the GA-400 corridor, with a rebuilt downtown and the Avalon mixed-use district. The Big Creek Greenway runs through town, and Wills Park offers ball fields, a pool and an equestrian center.",
    highlights: [
      "Downtown Alpharetta's City Center",
      "Avalon's shops, restaurants and events",
      "Big Creek Greenway trail",
      "Wills Park and its equestrian center",
    ],
    center: { lat: 34.0754, lng: -84.2941 },
  },
  {
    slug: "johns-creek",
    name: "Johns Creek",
    city: "Johns Creek",
    counties: ["Fulton"],
    region: "north",
    description:
      "Johns Creek, incorporated as a city in 2006, sits along the Chattahoochee River in northeast Fulton County. It's largely residential, with established subdivisions and golf communities, Newtown Park, and the Autrey Mill Nature Preserve.",
    highlights: [
      "Autrey Mill Nature Preserve and Heritage Center",
      "Newtown Park",
      "Chattahoochee River access through the national recreation area",
      "Atlanta Athletic Club, host of several major golf championships",
    ],
    center: { lat: 34.0289, lng: -84.1986 },
  },

  // ── West & South ───────────────────────────────────────────────────────────
  {
    slug: "marietta",
    name: "Marietta",
    city: "Marietta",
    counties: ["Cobb"],
    region: "west-south",
    description:
      "Marietta is the Cobb County seat, centered on a historic town square with Glover Park, the Strand Theatre and a weekend farmers market. Kennesaw Mountain National Battlefield Park lies just northwest of downtown, and historic homes line many surrounding streets.",
    highlights: [
      "Marietta Square, Glover Park and the Earl Smith Strand Theatre",
      "Kennesaw Mountain National Battlefield Park",
      "Marietta Square Farmers Market",
      "Marietta National Cemetery",
    ],
    center: { lat: 33.9526, lng: -84.5499 },
  },
  {
    slug: "smyrna",
    name: "Smyrna",
    city: "Smyrna",
    counties: ["Cobb"],
    region: "west-south",
    description:
      "Smyrna is a Cobb County city just northwest of Atlanta, with a walkable downtown built around Market Village. The Silver Comet Trail begins here, and Truist Park and The Battery Atlanta are a few minutes away.",
    highlights: [
      "Market Village and downtown Smyrna",
      "The Silver Comet Trail's eastern trailhead",
      "Minutes from Truist Park and The Battery Atlanta",
      "The Jonquil Festival, a nod to Smyrna's nickname, the Jonquil City",
    ],
    center: { lat: 33.884, lng: -84.5144 },
  },
  {
    slug: "kennesaw",
    name: "Kennesaw",
    city: "Kennesaw",
    counties: ["Cobb"],
    region: "west-south",
    description:
      "Kennesaw grew up along the Western & Atlantic Railroad and takes its name from nearby Kennesaw Mountain. Its downtown includes the Southern Museum of Civil War and Locomotive History, home of the General locomotive, and Kennesaw State University's main campus is nearby.",
    highlights: [
      "Kennesaw Mountain National Battlefield Park trails",
      "Southern Museum of Civil War and Locomotive History",
      "Swift-Cantrell Park",
      "Downtown along the historic railroad",
    ],
    center: { lat: 34.0234, lng: -84.6155 },
  },
  {
    slug: "peachtree-city",
    name: "Peachtree City",
    city: "Peachtree City",
    counties: ["Fayette"],
    region: "west-south",
    description:
      "Peachtree City is a planned community in Fayette County, about 30 miles south of downtown Atlanta. It's known for roughly 100 miles of multi-use paths traveled by golf cart, bike and foot, plus Lake Peachtree, Lake Kedron and The Fred amphitheater.",
    highlights: [
      "About 100 miles of golf-cart and multi-use paths",
      "Lake Peachtree and Lake Kedron",
      "The Fred, the city's outdoor amphitheater",
      "Village shopping centers connected by the path system",
    ],
    goodToKnow:
      "Golf carts driven on Peachtree City's path system must be registered with the city, and path rules apply. Many buyers budget for a cart along with the home.",
    center: { lat: 33.3968, lng: -84.5958 },
  },

  // ── Lake Lanier ────────────────────────────────────────────────────────────
  {
    slug: "lake-lanier",
    name: "Lake Lanier",
    city: "Buford",
    counties: ["Hall", "Forsyth", "Gwinnett", "Dawson", "Lumpkin"],
    region: "lake",
    description:
      "Lake Sidney Lanier is a U.S. Army Corps of Engineers reservoir on the Chattahoochee River, formed by Buford Dam in the 1950s. With hundreds of miles of shoreline, it's metro Atlanta's lake for boating and waterfront living, from Lake Lanier Islands near Buford to quiet coves farther north.",
    highlights: [
      "Marinas, boat ramps and swimming beaches in Corps of Engineers parks",
      "Lake Lanier Islands resort",
      "Buford Dam and Lower Pool Park",
      "Mall of Georgia a short drive away",
    ],
    goodToKnow:
      "Lanier's shoreline is federal land managed by the Army Corps of Engineers. A private dock needs a Corps permit, and not every lakefront lot qualifies, so ask us about a home's dock status before you fall for the view.",
    aliases: ["Lanier", "Lake Sidney Lanier"],
    center: { lat: 34.19, lng: -83.98 },
  },
];

/** Case/punctuation-insensitive key: "Virginia-Highland" and "virginia highland" match. */
export function normalizeAreaName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const byKey = new Map<string, Area>();
for (const a of areas) {
  for (const key of [a.slug, a.name, ...(a.aliases ?? [])]) {
    byKey.set(normalizeAreaName(key), a);
  }
}

/** Finds an area by slug, name or alias ("buckhead", "Old 4th Ward", "Virginia Highland"). */
export function findArea(nameOrSlug: string | null | undefined): Area | undefined {
  if (!nameOrSlug) return undefined;
  return byKey.get(normalizeAreaName(nameOrSlug));
}

/** "Fulton County" / "Hall, Forsyth, Gwinnett, Dawson and Lumpkin counties". */
export function countyLabel(area: Pick<Area, "counties">): string {
  const c = area.counties;
  if (c.length === 1) return `${c[0]} County`;
  return `${c.slice(0, -1).join(", ")} and ${c[c.length - 1]} counties`;
}

export function areaHref(area: Pick<Area, "slug">): string {
  return `/areas/${area.slug}`;
}
