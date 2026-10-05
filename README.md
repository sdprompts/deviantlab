# DeviantLab

A local DeviantArt uploader. Sign-in, the API, and the upload queue all run through the Vite dev server on this machine.

## Requirements

- [Node.js](https://nodejs.org/) 22.13 or newer (`node:sqlite` is used for the upload queue)
- A DeviantArt account
- Your own DeviantArt application (client id and client secret)

## DeviantArt application

DeviantLab signs in with OAuth on your machine. DeviantArt will not issue a token until the app you register lists the same redirect address this project uses.

1. Sign in on DeviantArt.
2. Open [Applications](https://www.deviantart.com/developers/apps).
3. Register an application. Choose the option that gives you both a **client id** and a **client secret** (a confidential client). The token exchange in this project sends the secret from the dev server. A public client that only gives you a client id cannot complete sign-in here.
4. In the OAuth2 redirect URI whitelist, add this address exactly, with no trailing slash:

   `http://localhost:5173/callback`

   DeviantArt matches the whitelist character for character. A different scheme, host, port, or path is rejected.
5. Copy the client id and client secret from that application page. Leave this browser tab open until the `.env` file below is saved.

**Sign in** sends you to DeviantArt and then back to DeviantLab. If this application is already allowed on the account, DeviantArt returns without another prompt. The first time, DeviantArt shows its authorize page for the application. Accept that page.

The login asks DeviantArt for `browse`, `user`, `stash`, and `publish`. Those names are not a separate checklist inside DeviantLab. If a later action says the login is missing a permission, sign out and sign in again.

## Install

```bash
npm install
```

Copy the example environment file and fill in the two values from your DeviantArt application:

```bash
cp .env.example .env
```

```
VITE_DA_CLIENT_ID=your-client-id
VITE_DA_REDIRECT_URI=http://localhost:5173/callback
DA_CLIENT_SECRET=your-client-secret
```

The client id is sent to DeviantArt from the browser, so its name starts with `VITE_`. Leave the secret named `DA_CLIENT_SECRET`. Vite copies every `VITE_` value into the web page, where it can be read.

`.env` stays on this machine. Git ignores it, so the secret is not added to the repository.

Start the app:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and click **Sign in**. DeviantArt sends you back to the callback address above. After that, the sidebar shows your username.

`npm run build` typechecks and builds the static app. The DeviantArt proxy and the publish queue exist only while `npm run dev` is running. Use the dev server to sign in, queue, and publish.

## What it does

The Uploads page has one drop box.

- **Queue for publish** puts the file in Working. After you add it to the queue, the dev server publishes one file per interval. **Post every** in Settings is that interval. The default is 30 minutes, and the allowed range is 5 to 1440.
- **Send to Stash** submits the file to Sta.sh and does not publish it. Those files are not placed in a gallery folder. After they are sent, they show on **Sent to Stash**.
- **No watermarks required**, when checked, sends that drop with no watermark. Leave it unchecked and the watermark from Settings is applied when the file is sent.

A title and at least one tag are required before a file can join the queue or be sent to Sta.sh. You can type them, or let a vision model fill them in, then edit them.

**Working** holds files that still need a title and tags. **Queued** holds files waiting for the schedule. **Published** lists files this app has published, newest first, with the date and time. **Sent to Stash** lists files submitted to Sta.sh.

On Queued, **Cards** and **Thumbs** switch the layout. **Pause** stops later publishes and leaves the one already sending alone. **Shuffle** randomizes the files that are still waiting. **Publish now** sends one file and does not reset the schedule.

**Folders** appear on a file that is going to be published. They are your DeviantArt gallery folders. Checked folders are where the publish goes. If none are checked, DeviantArt puts the deviation in Featured. Send to Stash does not show folders, because those files are not published. If the folder list says the login is missing a permission, sign out and sign in again.

Originals on disk are not overwritten. Each sent file is re-encoded as a JPEG. Other metadata is stripped. The name or copyright line from Settings is added to the image metadata. When **No watermarks required** was unchecked, the watermark is placed in the corner and at the width chosen in Settings.

The queue, the image copies DeviantLab keeps, and the watermark PNG (`.studio/watermark.png`) are stored in `.studio/`. That folder stays on this machine and is gitignored. Publishing pauses while the dev server is stopped. When it starts again, one overdue file is sent, then the interval resumes. It does not catch up by posting the whole backlog at once. The first file added while nothing is scheduled waits one full interval.

## Settings

Settings is split into **Publishing**, **Titles and tags**, **Watermark**, and **History**.

### Publishing

- **Post every** — minutes between publishes. The value is kept between 5 and 1440.
- **Your name or copyright, added to the image metadata when sent** — what to type is a credit line, such as `© Your name`. When a file is sent, that text is stored inside the JPEG as its description metadata. It is separate from the description on the DeviantArt deviation. Leave it blank and no description metadata is written.
- **Applied to each new upload** — **Mature**, **AI generated**, and **Do not include in third-party AI datasets** are copied onto each new file. The checkboxes on that file are what get published. Changing these later does not change files already dropped.

### Titles and tags

A title and at least one tag are required. You can type them, or let a vision model fill them in.

In Settings, **Suggest titles and tags** is on by default. Turn it off and the title and tags stay empty. The model, base URL, and API key you already saved stay in place for when you turn it back on.

While it is on, each drop sends one JPEG, resized to fit inside 1024×1024, and asks for a title and tags. The reply is capped at 800 tokens. You can edit both before the file is queued or sent.

Set **Provider** in Settings. That shows suggested model ids for that provider. Click one to fill **Model id**, or type a different id. Choosing a provider does not fill the model by itself. Leave **Base URL** blank to use the provider default. Paste the **API key** for that provider. LM Studio has no key. The key is stored in this browser and on the dev server. It is not written into the repo.

| Provider | Key | Model id to type | Blank base URL calls |
| --- | --- | --- | --- |
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) | `google/gemma-4-26b-a4b-it` | `https://openrouter.ai/api/v1` |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | `gpt-4.1-mini` | `https://api.openai.com/v1` |
| Claude | [Claude Console → API keys](https://platform.claude.com/settings/keys) | `claude-haiku-4-5` | `https://api.anthropic.com` (the base URL field is ignored) |
| Grok | [console.x.ai](https://console.x.ai/) → API keys | `grok-4.3` | `https://api.x.ai/v1` |
| Gemini | [Google AI Studio → API keys](https://aistudio.google.com/apikey) | `gemini-2.5-flash` | `https://generativelanguage.googleapis.com/v1beta` |
| LM Studio | None. Start LM Studio’s local server with a vision model loaded. | `qwen/qwen3-vl-4b`, or the id LM Studio shows for the loaded model. | `http://localhost:1234/v1` |

Prices change. For one title on a small vision model, expect a fraction of a US cent. A few hundred titles is often under a dollar. A large model that spends tokens on reasoning can be a few cents a title. Check the provider’s pricing page if you are about to run a big batch.

- **LM Studio** has no API fee. It uses your machine.
- **Gemini 2.5 Flash** has a free tier with daily limits. Paid use is about $0.30 per million input tokens and $2.50 per million output tokens, so one 1024px title is usually well under a cent.
- **OpenAI** mini-class vision models are a fraction of a cent. A full-size model is closer to a cent.
- **Claude** Haiku-class models are under a cent. Larger Claude models cost more for the same picture.
- **Grok** chat models are about $1–$2 per million input tokens, so one title is around a cent or less.
- **OpenRouter** charges that model’s listed price, sometimes with a small markup. The model page is the rate that applies.

The OpenRouter suggestion buttons are:

- `google/gemma-4-26b-a4b-it` — the one to start with. It reads images and is the cheap model, about $0.04 per million input tokens.
- `google/gemini-2.5-flash` — when Gemma titles are flat. About $0.30 per million input tokens.
- `anthropic/claude-haiku-4.5` — when the cheaper titles are flat. About $1 per million input tokens and $5 per million output tokens, still under a cent for one title.

Skip models whose job is to draw a picture (names like Image, Nano Banana, or GPT Image). Those do not return a title and tags. The model page must list image as an input.

For LM Studio, download a model from [Qwen3-VL](https://lmstudio.ai/models/qwen3-vl). Choose the Instruct build. A Thinking build can spend the whole reply before it writes a title. Load it and start the local server. Leave **API key** empty. Leave **Base URL** blank unless you changed LM Studio’s port. The suggestion buttons are:

- `qwen/qwen3-vl-4b` — the one to start with.
- `qwen/qwen3-vl-8b` — use this when the 4B titles are thin and the machine can hold it.
- `qwen/qwen3-vl-2b` — use this when the 4B model does not fit. The smallest Qwen3-VL needs about 3 GB.

There is no API charge. The model runs on your machine.

### Watermark

Choose a PNG. A file larger than 1.5 MB is ignored. A transparent PNG keeps the artwork visible around the mark. After you choose it, the PNG is shown on this screen. **Remove** clears it.

**Width** is the mark’s width in pixels, from 40 to 2000. 400 is the default. **Corner** is bottom right, bottom left, top right, or top left. Bottom right is the default. The mark is set 12px in from that corner.

**Drop an image to preview** composites your watermark onto that image at the current width and corner. The preview stays on the Settings screen and is not queued or sent.

On Uploads, leave **No watermarks required** unchecked and this PNG is applied when the file is sent. Check it and that file is sent with no watermark. A new PNG, corner, or width applies to the next file that is sent. Files already encoded are left as they are.

The PNG DeviantLab uses at send time is `.studio/watermark.png`. `.studio/` is gitignored, so the watermark is not committed. This browser also keeps a copy of the PNG.

### History

**Clear history** opens a confirmation. Confirming removes published images and images sent to Stash from this app. **Also delete the copies kept on this computer** deletes the files DeviantLab stored for those images. Leave that unchecked and the list is cleared while the copies in `.studio/` remain. DeviantArt keeps the ones already published or sitting in Stash. Files still in Working, waiting, or queued are left alone.

## Limits

- Login is required.
- Only files dropped in DeviantLab are queued. Nothing else in Sta.sh is listed or published.
- Unpublished files are submitted to Sta.sh and then published. DeviantArt’s public API does not offer a separate Studio-draft write.
- After a DeviantArt rate-limit response, wait 15 minutes before trying again. Refreshing sooner extends the pause.

Licensed under the [MIT License](LICENSE). Copyright (c) 2026 sdprompts.

[![Support me on Ko-fi](https://img.shields.io/badge/Support%20me%20on%20Ko--fi-05cc47?style=for-the-badge&logo=kofi&logoColor=black)](https://ko-fi.com/H2H514IXI3)
