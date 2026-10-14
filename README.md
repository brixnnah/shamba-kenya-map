# Shamba — Kenya land map

A phone-friendly parcel mapping MVP. Users can capture parcel boundaries with
their device GPS, add title-deed references and notes, and review or delete
personal parcel records.

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
   reference, county, or notes you want to keep.

Parcel records are stored in this browser on this device. Boundary capture and
records work offline after the app has loaded; map imagery is available offline
only for tiles the device has already cached. There is no account, cloud backup,
or automatic server sync in this MVP. Title-deed information is user-entered
and is not checked against official Kenyan records; mapped boundaries are not
an official survey or proof of ownership.

The basemap uses OpenStreetMap tiles and requires an internet connection for
areas that have not already been viewed. Browser location access requires
HTTPS (or localhost during development).
