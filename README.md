# TV Tracker

Track your favourite TV shows.

## Stack
- React + Vite
- Supabase Auth (Magic Link)
- Netlify Functions
- TheTVDB API
- Capacitor (Android)

## Local setup
1. Copy `.env.example` to `.env`
2. Add your Supabase keys
3. Run `npm install`
4. Run `npm run dev`

## Android setup

Capacitor is configured for the BURGRS Android app with the application ID `com.maviuk.burgrs`.

1. Install dependencies with `npm install`
2. Create the native Android project once with `npm run cap:add:android`
3. Build the website, sync it into Android, and open Android Studio with `npm run android`

After later website changes, run `npm run cap:sync` to rebuild and copy the latest web files into the Android project.

## Performance checks
For a small public performance baseline, see [load testing](scripts/LOAD_TESTING.md).

## Features planned
- Search shows
- Airing today
- Upcoming episodes
- Watch tracking
- Push notifications
