[out:json][timeout:90][bbox:34.60,135.40,34.75,135.60];
(
  nwr["name"]["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|aquarium|theme_park)$"];
  nwr["name"]["amenity"~"^(restaurant|cafe|place_of_worship)$"];
  nwr["name"]["shop"~"^(mall|department_store)$"];
  nwr["name"]["leisure"~"^(park|garden)$"];
  nwr["name"]["historic"="castle"];
);
out meta center;
