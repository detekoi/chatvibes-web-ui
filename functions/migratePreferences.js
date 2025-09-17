// functions/migratePreferences.js
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const db = new Firestore();
const TTS_CONFIG_COLLECTION = 'ttsChannelConfigs';
const USER_PREFS_COLLECTION = 'ttsUserPreferences';

async function migratePreferences() {
  console.log('Starting migration of user preferences...');

  const channelConfigsSnapshot = await db.collection(TTS_CONFIG_COLLECTION).get();

  if (channelConfigsSnapshot.empty) {
    console.log('No channel configurations found. Nothing to migrate.');
    return;
  }

  let batch = db.batch();
  let migratedPreferencesCount = 0;
  let opsInBatch = 0;

  for (const doc of channelConfigsSnapshot.docs) {
    const channelData = doc.data();
    const userPreferences = channelData.userPreferences;
    if (userPreferences && typeof userPreferences === 'object') {
      for (const username of Object.keys(userPreferences)) {
        const userPrefData = userPreferences[username] || {};
        const userDocRef = db.collection(USER_PREFS_COLLECTION).doc(username.toLowerCase());
        const newPrefData = { ...userPrefData, updatedAt: FieldValue.serverTimestamp() };
        batch.set(userDocRef, newPrefData, { merge: true });
        migratedPreferencesCount++;
        opsInBatch++;
        // Firestore batch limit safeguard
        if (opsInBatch >= 400) {
          await batch.commit();
          batch = db.batch();
          opsInBatch = 0;
          console.log('Committed intermediate batch during migration...');
        }
      }
    }
  }

  if (opsInBatch > 0) {
    await batch.commit();
  }

  if (migratedPreferencesCount > 0) {
    console.log(`Successfully migrated ${migratedPreferencesCount} user preferences.`);
  } else {
    console.log('No user preferences found to migrate.');
  }
}

migratePreferences().catch(error => {
  console.error('An error occurred during the migration.', error);
});


