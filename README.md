# LeadDesk

**Open-source outreach CRM.** Find businesses on Google Maps, write each one a personal message with Claude, send over WhatsApp with anti-ban protection, and track every reply. Self-hosted, one process, SQLite.

![LeadDesk](https://paoloothedev.com/leaddesk-preview.png)

## Features

- **Google Maps scraper:** search by keyword and location, then add the results to your contacts automatically or review them first.
- **Contacts, companies and deals:** tags, stages, custom fields, duplicate merge, saved views, Kanban pipelines and global search.
- **WhatsApp campaigns:** group contacts into campaigns, send now or schedule, and open any broadcast to see who got it, who replied and exactly what they received.
- **Anti-ban engine:** warm-up, daily and hourly limits, human pacing, sending hours in the recipient's timezone, content checks and a health score that slows or stops sending.
- **WhatsApp inbox:** read and answer chats inside LeadDesk with your team. Every 1:1 message in and out is saved, even ones sent from the phone or deleted on WhatsApp. Assign chats and mark them done.
- **Number memory:** LeadDesk remembers each WhatsApp number. Log out and link it again and its warm-up, health and limits come back; a new number starts its own warm-up.
- **Claude integration (MCP):** connect Claude to LeadDesk so it can scrape, write a message per contact, create campaigns and schedule broadcasts.
- **Workspaces and team accounts:** separate data per client business, roles and permissions, audit log, backup and restore.

> **WhatsApp risk:** sending uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp Web client, which is against WhatsApp's terms. The anti-ban engine lowers the risk of a ban but cannot remove it. Use a number you can afford to lose, and only message people you have a legitimate reason to contact.

## Quick start

You need [Docker](https://docs.docker.com/get-docker/). Then:

```bash
curl -O https://raw.githubusercontent.com/paoloothedev/leaddesk/main/docker-compose.yml
docker compose up -d
```

Open **http://localhost:3001**. The setup wizard creates your admin account and first workspace, and a short tour shows you around. There is no default password.

Your data lives in a Docker volume (`leaddesk-data`), so it survives restarts and updates.

### Updating

```bash
docker compose pull
docker compose up -d
```

### Change the port

Create a `.env` file next to `docker-compose.yml` (see [.env.example](.env.example)):

```
LEADDESK_PORT=8080
```

### Build it yourself

```bash
git clone https://github.com/paoloothedev/leaddesk.git
cd leaddesk
docker compose up -d --build
```

### Without Docker

Requires [Node.js](https://nodejs.org/) 18 to 22. Node 24 is not supported yet because of the SQLite driver.

```bash
git clone https://github.com/paoloothedev/leaddesk.git
cd leaddesk
npm run setup
npx --prefix server playwright install chromium
npm run build
npm start
```

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, Framer Motion, Phosphor Icons
- **Backend:** Node.js, Express, better-sqlite3
- **WhatsApp:** Baileys (unofficial WhatsApp Web API)
- **Scraper:** Playwright

## Project Structure

```
leaddesk/
├── client/          # React frontend
│   └── src/
│       ├── components/   # UI components
│       └── api.js        # API client
├── server/          # Express backend
│   ├── routes/      # API routes
│   └── db.js        # SQLite database
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Configuration

LeadDesk uses SQLite, so no external database is needed.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Port the server listens on (with Docker, set `LEADDESK_PORT` instead) |
| `HOST` | `0.0.0.0` | Address to bind |
| `DB_PATH` | `server/leaddesk.db` | Database file (`/data/leaddesk.db` in Docker) |
| `GMAPS_JOBS_FILE` | `server/gmaps/jobs_data.json` | Scraper jobs and results |
| `WA_AUTH_DIR` | `server/baileys_auth` | WhatsApp session files. Keep these private |
| `WA_MEDIA_DIR` | next to `WA_AUTH_DIR` | Photos, voice notes and files received on WhatsApp |
| `CORS_ORIGINS` | none | Extra browser origins allowed to call the API, comma separated |
| `CHROMIUM` | auto | Path to a Chromium binary for the scraper |

## Going public

Put LeadDesk behind HTTPS, for example with a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Failed logins are rate limited, and session cookies are marked `Secure` over HTTPS.

## Connect Claude

In LeadDesk go to **Settings → Claude (MCP)**, create a token and add the URL it shows as a custom connector in Claude. The token is part of that URL, so treat it like a password. You can revoke it from the same page.

## Tests

```bash
npm test --prefix server
```

## Contributing

Contributions are welcome! Feel free to open issues and pull requests.

## License

[MIT](LICENSE)

## Author

Built by [PaoloTheDev](https://paoloothedev.com)

## Support

If you find LeadDesk useful, consider supporting the project:

[![Donate via PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/youssef.mohamad.abdallah)
