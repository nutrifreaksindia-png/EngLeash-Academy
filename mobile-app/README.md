# EngLeash Academy Mobile App

## API Configuration

Create a `.env` file in this folder (you can copy `.env.example`) and configure one of the following:

- `EXPO_PUBLIC_API_BASE`: full backend URL (preferred for stable environments)
- `EXPO_PUBLIC_DEV_API_HOST` + `EXPO_PUBLIC_DEV_API_PORT`: fallback used in local dev if full base is not set

Examples:

```env
EXPO_PUBLIC_API_BASE=http://192.168.0.8:3001
```

or

```env
EXPO_PUBLIC_DEV_API_HOST=192.168.0.8
EXPO_PUBLIC_DEV_API_PORT=3001
```

## Run

```sh
npm install
npm run start:dev-client
npm run run:android
```
