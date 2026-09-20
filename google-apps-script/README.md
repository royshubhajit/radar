# Google Sheets Integration Setup Guide

Follow these simple steps to connect your Google Sheet to the Crypto Radar site and enable 24/7 automated 2-hour checks:

---

### Step 1: Create a New Google Sheet
1. Open Google Drive and create a **Blank Spreadsheet** (or visit [sheets.new](https://sheets.new)).
2. Name the sheet something like `Crypto Radar Predictions`.

---

### Step 2: Paste the Apps Script Code
1. In your Google Sheet, click on **Extensions** > **Apps Script** in the top menu.
2. In the code editor that opens, delete any default code inside `Code.gs`.
3. Copy all the code from [`google-apps-script/Code.gs`](./Code.gs) and paste it into the editor.
4. Click the **Save** icon (floppy disk) or press `Ctrl + S` / `Cmd + S`.

---

### Step 3: Run Setup & 15-Minute Trigger
1. At the top of the Apps Script editor, select **`setupSheet`** from the function dropdown and click **Run**.
   * *(Google will ask for permission the first time. Click "Review permissions" -> select your Google account -> click "Advanced" -> click "Go to Untitled project (unsafe)" -> click "Allow".)*
   * Your Google Sheet will immediately be formatted with dark headers and frozen rows!
2. Now select **`createFifteenMinuteTrigger`** from the dropdown and click **Run**.
   * This activates the 24/7 automated checker that runs on Google Cloud every 15 minutes to evaluate your predictions!

---

### Step 4: Deploy as Web App & Get Webhook URL
1. Click the blue **Deploy** button in the top right corner -> select **New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in the fields:
   * **Description**: `Crypto Radar Webhook`
   * **Execute as**: `Me (<your email>)`
   * **Who has access**: **`Anyone`** *(Important: Choose "Anyone" so the website can post predictions to your sheet without requiring OAuth login)*.
4. Click **Deploy**.
5. Copy the **Web App URL** (it looks like `https://script.google.com/macros/s/AKfycb.../exec`).

---

### Step 5: Connect in the Radar Website
1. Go to your Crypto Radar site.
2. Look at the **🎯 Target Prediction** card on the right sidebar (below the Futures Calculator).
3. Click the ⚙️ (Settings) icon.
4. Paste your **Web App URL** and your **Google Sheet URL**.
5. Click **Save Settings**.

You're done! Now whenever you click on any coin and log a prediction, it instantly writes to your Google Sheet, and Google's cloud will automatically monitor and evaluate the price every 15 minutes!
