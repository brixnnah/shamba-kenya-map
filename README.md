# Shamba — Kenya land map

A phone-friendly parcel mapping MVP. Users can capture parcel boundaries with
their device GPS, add title-deed references, photos and documents, record their
latest visit, and review or delete personal parcel records.

## Run locally

Serve this folder from `localhost` or an HTTPS host. GPS access and service
workers are restricted to secure contexts by browsers. For example, with Node:

```powershell
npx --yes http-server . -p 8080
```

Open `http://localhost:8080`. On a phone, install the site from its browser menu
after deploying it to an HTTPS host.

## Using the map

1. Choose **Map a parcel** and allow location access.
2. Walk the parcel boundary outdoors with GPS enabled. Points are recorded when
   the reported GPS accuracy is 35 metres or better. You can also choose
   **Tap map to add a point instead** to place boundary points manually.
3. Add at least three points, then save the parcel with a name and any deed
   reference, deed photo, documents, county, or notes you want to keep. On a
   phone, choose **Take or choose a photo** to use the camera or select an
   existing image. Attach PDF, Word, Excel, text, or image files up to 25 MB
   each.
4. Open a parcel record and choose **I visited this plot** to save the current
   date and time. Visit dates are recorded when you tap the button; the app
   does not track your visits in the background.
5. Use the search box over the map to look up a town, landmark, or address, then
   choose a result to move the map there.

Parcel records, compressed deed photos, and attached documents are stored in
this browser on this device. Boundary capture and records work offline after
the app has loaded; map imagery is available offline only for tiles the device
has already cached. There is no account, cloud backup, or automatic server
sync in this MVP. Location search sends the search term to OpenStreetMap's
public Nominatim geocoding service and requires an internet connection.
Title-deed information is user-entered and is not checked against official
Kenyan records; mapped boundaries are not an official survey or proof of
ownership.

Use the **Satellite** button to switch between the OpenStreetMap road view and
Esri satellite imagery with place labels. Both basemaps need an internet
connection for areas that have not already been viewed and are cached for
offline use after loading. The app uses a familiar map-focused layout but is
not Google Maps. Browser location access requires HTTPS (or localhost during
development).
