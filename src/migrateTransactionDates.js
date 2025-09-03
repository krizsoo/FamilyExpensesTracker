// migrateTransactionDates.js
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

// TODO: Replace with your Firebase project config or use applicationDefault()
admin.initializeApp({
  credential: applicationDefault(),
  // databaseURL: "https://<YOUR_PROJECT_ID>.firebaseio.com"
});

const db = getFirestore();
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateTransactionDates() {
  const collectionPath = 'artifacts/family-finance-tracker-v1/families/shared-family-data/transactions';
  const snapshot = await db.collection(collectionPath).get();
  let updated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const dateField = data.transactionDate;

    // Only migrate if it's a Firestore Timestamp
    if (dateField instanceof Timestamp) {
      const jsDate = dateField.toDate();
      const yyyy = jsDate.getFullYear();
      const mm = String(jsDate.getMonth() + 1).padStart(2, '0');
      const dd = String(jsDate.getDate()).padStart(2, '0');
      const dateString = `${yyyy}-${mm}-${dd}`;

      await doc.ref.update({ transactionDate: dateString });
      updated++;
      console.log(`Updated ${doc.id}: ${dateString}`);
    }
  }

  console.log(`Migration complete. Updated ${updated} documents.`);
}

migrateTransactionDates().catch(console.error);