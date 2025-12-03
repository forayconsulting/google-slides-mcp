# Google OAuth 2.0 Setup Guide

This guide walks you through setting up Google OAuth 2.0 credentials for the Google Slides MCP Server. Follow each step carefully.

## Prerequisites

- A Google account
- Access to [Google Cloud Console](https://console.cloud.google.com/)

---

## Step 1: Create a New Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top of the page (next to "Google Cloud")
3. Click **"New Project"** in the top-right of the modal
4. Enter a project name: `Google Slides MCP` (or your preferred name)
5. Click **"Create"**
6. Wait for the project to be created (you'll see a notification when complete)
7. Switch to the new project by clicking the project dropdown and selecting **"Google Slides MCP"**

---

## Step 2: Enable Required APIs

### Enable Google Slides API

1. In the left sidebar, click **"APIs & Services"** or find it in the Quick Access section
2. Click **"+ Enable APIs and services"** at the top
3. In the search box, type **"Google Slides"**
4. Click on **"Google Slides API"** in the results
5. Click **"Enable"**

### Enable Google Drive API

1. Click **"Library"** in the left sidebar to return to the API Library
2. In the search box, type **"Google Drive"**
3. Click on **"Google Drive API"** in the results
4. Click **"Enable"**

---

## Step 3: Configure OAuth Consent Screen

Before creating OAuth credentials, you must configure the consent screen that users see when authenticating.

1. In the left sidebar, click **"OAuth consent screen"** (under APIs & Services)
2. You'll see a welcome page - click **"Get started"**

### App Information

3. Fill in the **App Information**:
   - **App name**: `Google Slides MCP`
   - **User support email**: Select your email from the dropdown
4. Click **"Next"**

### Audience

5. Select **"External"** for User type
   - This is required if you're not part of a Google Workspace organization
   - Your app will start in "testing" mode, which is fine for personal use
6. Click **"Next"**

### Contact Information

7. Enter your email address in the **"Email addresses"** field
8. Click **"Next"**

### Finish

9. Review your settings and click **"Create"** to finish

---

## Step 4: Create OAuth 2.0 Client Credentials

Now create the actual credentials your application will use.

1. In the left sidebar, click **"Clients"** (you should be in the Google Auth Platform section)
   - Alternatively, go to **"Credentials"** under APIs & Services and click **"+ Create Credentials"** → **"OAuth client ID"**
2. Click **"+ Create Client"** or **"Create OAuth client"**

### Configure the Client

3. In the **"Application type"** dropdown, select **"Desktop app"**
4. For **"Name"**, enter: `Google Slides MCP`
5. Click **"Create"**

### Save Your Credentials

6. A dialog will appear showing your credentials:
   - **Client ID**: Something like `123456789-abc123xyz.apps.googleusercontent.com`
   - **Client Secret**: Something like `GOCSPX-AbCdEfGhIjKlMnOpQrStUvWxYz`

7. Click **"Download JSON"** to save a backup of your credentials
8. Click **"OK"** to close the dialog

> **Important**: Store your Client Secret securely. Never commit it to version control or share it publicly.

---

## Step 5: Add Test Users

Since your app is in "testing" mode, only designated test users can authenticate.

1. In the left sidebar, click **"Audience"**
2. Scroll down to the **"Test users"** section
3. Click **"+ Add users"**
4. Enter the email address of the Google account you'll use with the MCP server
5. Click **"Save"**

You can add up to 100 test users while in testing mode.

---

## Step 6: Configure Your Environment

Create a `.env` file in your project root with your credentials:

```bash
# Copy the example file
cp .env.example .env
```

Edit `.env` and add your credentials:

```bash
# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Server configuration
MCP_SERVER_HOST=0.0.0.0
MCP_SERVER_PORT=8000
MCP_TRANSPORT=stdio

# OAuth 2.1 settings
MCP_ENABLE_OAUTH21=false
MCP_BASE_URL=http://localhost:8000

# Logging
LOG_LEVEL=INFO
```

> **Security Note**: The `.env` file is listed in `.gitignore` and will not be committed to version control.

---

## Verification Checklist

Before using the MCP server, verify that you have:

- [ ] Created a Google Cloud project
- [ ] Enabled the **Google Slides API**
- [ ] Enabled the **Google Drive API**
- [ ] Configured the **OAuth consent screen**
- [ ] Created **OAuth 2.0 Desktop client credentials**
- [ ] Added yourself as a **test user**
- [ ] Saved credentials to your `.env` file

---

## Troubleshooting

### "Access blocked: This app's request is invalid"

This usually means:
- The OAuth consent screen is not configured
- You're trying to authenticate with an account not listed as a test user

**Solution**: Add your Google account as a test user in the Audience section.

### "Error 403: access_denied"

This means the user denied consent or isn't authorized.

**Solution**:
1. Ensure your account is added as a test user
2. Try the OAuth flow again and click "Allow" on all consent screens

### "Error: invalid_client"

Your Client ID or Client Secret is incorrect.

**Solution**:
1. Go to Google Cloud Console → APIs & Services → Credentials
2. Click on your OAuth client to view the credentials
3. Verify the Client ID and Client Secret match your `.env` file

### "This app isn't verified"

This warning appears because your app is in testing mode.

**Solution**: Click **"Continue"** (you may need to click "Advanced" first). This is expected for apps in testing mode.

---

## Publishing Your App (Optional)

If you want to use the MCP server with accounts other than your test users, you'll need to publish your app:

1. Go to **"Audience"** in the left sidebar
2. Click **"Publish app"**
3. Follow the verification process

Note: Publishing requires verification by Google, which may take several days and requires additional information like a privacy policy.

For personal use, staying in "testing" mode with designated test users is simpler.

---

## Next Steps

Once your OAuth credentials are configured:

1. Install the package:
   ```bash
   pip install -e ".[dev]"
   ```

2. Run the server:
   ```bash
   google-slides-mcp --transport stdio
   ```

3. Configure your MCP client (Claude Desktop, etc.) to use the server

See the main [README](../README.md) for detailed usage instructions.
