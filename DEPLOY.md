# Deploying TripSync

TripSync deploys as **one web service** (Express API + Socket.IO + the built React app) on
[Render](https://render.com), with the database on [MongoDB Atlas](https://www.mongodb.com/atlas).
Both have free tiers. The repository already contains everything Render needs (`render.yaml`).

Everything below marked **YOU** needs your own accounts, so it has to be done by you. It takes about 30 minutes.

---

## 0. Local setup: TomTom key in `.env` (YOU)

Live traffic on your own machine needs the key in `tripsync/.env`:

1. Open `tripsync/.env` and find line 26: `TOMTOM_API_KEY=`
2. Paste the key directly after `=` (no quotes, no spaces) and **save**.
3. Restart the API (`npm run dev:server`). The live tracking page should then show
   "Routing: tomtom · live traffic".

## 1. Get a TomTom API key (YOU)

1. Go to https://developer.tomtom.com and click **Register** (free, no card needed).
2. Verify your email and sign in.
3. Open **Dashboard → Keys**. A default key ("My first API key") is created for you and includes
   the Routing API. Copy it.
4. Free tier: about 2,500 routing requests per day. That's plenty for personal use and demos.

## 2. Create the database on MongoDB Atlas (YOU)

1. Sign up at https://www.mongodb.com/cloud/atlas/register.
2. **Create a cluster** → choose the free **M0** tier → provider **AWS** → region **Singapore
   (ap-southeast-1)**, or Mumbai. Pick one close to the Render region in `render.yaml` (Singapore).
3. **Database Access → Add New Database User**: choose a username and use **Autogenerate
   Secure Password**. Copy the password.
4. **Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`)**. Render's free
   plan has no fixed outgoing IP. The database stays protected by the username and password.
5. **Connect → Drivers** and copy the connection string. It looks like:
   `mongodb+srv://USER:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Replace `<db_password>` with the password, and add the database name `tripsync` after
   `.net/`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/tripsync?retryWrites=true&w=majority`
   If the password contains `@ : / ? #`, URL-encode those characters.

## 3. Put the code on GitHub (YOU + Claude)

1. **YOU:** at https://github.com/new create an **empty private** repository named `tripsync`
   (no README, no .gitignore, no license).
2. Send Claude the repository URL. Claude adds it as the remote and pushes the code. Git may open
   a GitHub sign-in window the first time: sign in there.

`.env` is ignored by git, so your keys and passwords are never uploaded.

## 4. Deploy on Render (YOU)

1. Sign up at https://render.com with your GitHub account, and allow access to the `tripsync`
   repository.
2. Click **New + → Blueprint** and select the `tripsync` repository. Render reads `render.yaml`.
3. Fill in the values it asks for:

   | Variable | Value |
   | --- | --- |
   | `MONGODB_URI` | The Atlas connection string from step 2 |
   | `TOMTOM_API_KEY` | Your TomTom key from step 1 |
   | `PROVIDER_USER_AGENT` | `TripSync/1.0 (your-email@example.com)`. OpenStreetMap services require a contact in the User-Agent |

   `JWT_SECRET` is generated automatically. `NODE_ENV`, `TRUST_PROXY` and the rest are already set.
4. Click **Apply**. The first build takes about 5 minutes.
5. Open the URL Render shows (`https://tripsync-xxxx.onrender.com`). Check that
   `https://tripsync-xxxx.onrender.com/api/health` returns `{"status":"ok","db":"up",…}`.
6. Register an account in the app and start planning.

### Optional after deploying

- **Sample data:** to load the demo trips into Atlas, run this on your own machine (PowerShell, in
  the `tripsync` folder):
  ```powershell
  $env:MONGODB_URI = "<your Atlas connection string>"; npm run seed; Remove-Item Env:MONGODB_URI
  ```
  This creates the sample accounts (`alice@tripsync.test` and so on) with a publicly known password.
  Only do this for demos.
- **AI itineraries:** create a key at https://console.anthropic.com (paid per use). In Render, open
  **Environment**, add `AI_API_KEY` and save. The service redeploys.
- **Real GPS only:** set `ALLOW_DEMO_SIMULATION` to `false` in Render to hide the "Simulate walk"
  button.
- **Custom domain:** Render → Settings → Custom Domains. Nothing else needs changing, because the
  app accepts its own origin automatically. Only add `CLIENT_URL` if the React app is hosted
  somewhere else.

## Things to know about the free tiers

- **Render free** puts the service to sleep after about 15 minutes without visitors. The next visit
  takes roughly a minute to wake it. While it sleeps, background jobs don't run: no reminders,
  traffic checks or "missed activity" updates. For always-on notifications, switch the service to a
  paid instance type (Render → Settings → Instance Type).
- **TomTom free:** about 2,500 routing requests per day. Tracking uses roughly 12 per hour per
  traveller, and the traffic job a few per active trip per hour.
- **Atlas M0:** 512 MB of storage. Location history is deleted automatically after
  `LOCATION_RETENTION_DAYS` (30).
- **Location sharing** needs HTTPS. Render provides it, and phones ask for permission the first
  time.

## Other hosts (Docker)

The `Dockerfile` builds the same single service:

```bash
docker build -t tripsync .
docker run -p 4000:4000 -e NODE_ENV=production -e MONGODB_URI=... -e JWT_SECRET=... -e TOMTOM_API_KEY=... -e TRUST_PROXY=true tripsync
```

Set `CLIENT_URL` to the public URL when running behind a domain, and `TRUST_PROXY=true` when behind
a load balancer or reverse proxy.

## Security checklist

- Never commit `.env`, and never paste keys into chats or issues. If a key leaks, regenerate it in
  the provider's dashboard and update Render's **Environment** tab.
- Keep the Atlas user limited to this database, and use a long generated password.
- `JWT_SECRET` must stay secret. Changing it signs everyone out.
