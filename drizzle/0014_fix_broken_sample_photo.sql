-- Data only. One sample kitchen photo in the demo data, Unsplash's
-- photo-1600607687644-c7171b42498b, now answers 404 (site review, "Links and images").
-- The seed stopped using it in c788416, but a preview database seeded before that still
-- shows it as a broken image, and demo data is only ever seeded into an empty database.
-- Point those rows at the seed's replacement kitchen photo. Real MLS data never has this
-- URL, so on a live database this changes nothing.
UPDATE "listing_media"
   SET "url" = replace("url", 'photo-1600607687644-c7171b42498b', 'photo-1556912173-3bb406ef7e77')
 WHERE "url" LIKE 'https://images.unsplash.com/photo-1600607687644-c7171b42498b%';--> statement-breakpoint
UPDATE "listings"
   SET "primary_photo_url" = replace("primary_photo_url", 'photo-1600607687644-c7171b42498b', 'photo-1556912173-3bb406ef7e77')
 WHERE "primary_photo_url" LIKE 'https://images.unsplash.com/photo-1600607687644-c7171b42498b%';
