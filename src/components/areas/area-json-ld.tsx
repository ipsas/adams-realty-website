import { site } from "@/config/site";
import type { Area } from "@/config/areas";

/** schema.org Place (with geo, address and county) plus breadcrumbs for a guide page. */
export function AreaJsonLd({ area, baseUrl }: { area: Area; baseUrl: string }) {
  const url = `${baseUrl}/areas/${area.slug}`;
  const json = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Place",
        "@id": `${url}#place`,
        name: area.name,
        description: area.description,
        url,
        geo: {
          "@type": "GeoCoordinates",
          latitude: area.center.lat,
          longitude: area.center.lng,
        },
        address: {
          "@type": "PostalAddress",
          addressLocality: area.city,
          addressRegion: site.market.state,
          addressCountry: "US",
        },
        containedInPlace: area.counties.map((c) => ({
          "@type": "AdministrativeArea",
          name: `${c} County, ${site.market.stateName}`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: site.name, item: baseUrl },
          {
            "@type": "ListItem",
            position: 2,
            name: "Neighborhood guides",
            item: `${baseUrl}/areas`,
          },
          { "@type": "ListItem", position: 3, name: area.name, item: url },
        ],
      },
    ],
  };
  return (
    <script
      type="application/ld+json"
      // Escaping "<" keeps any text from closing the script tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, "\\u003c") }}
    />
  );
}
