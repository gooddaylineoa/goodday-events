import * as adminNS from 'firebase-admin';
const admin = adminNS.default || adminNS;

let initError = null;

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY
          ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
          : undefined
      })
    });
  }
} catch (e) {
  initError = e.message;
}

export default async function handler(req, res) {
  if (initError) {
    return res.status(500).json({ error: 'Firebase Admin เริ่มต้นไม่สำเร็จ', detail: initError });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST เท่านั้น' });
  }

  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'ไม่พบ idToken' });
  }

  try {
    const params = new URLSearchParams();
    params.append('id_token', idToken);
    params.append('client_id', process.env.LINE_CHANNEL_ID);

    const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'LINE token ไม่ถูกต้อง', detail: verifyData });
    }

    const lineUserId = verifyData.sub;
    const uid = `line_${lineUserId}`;

    const userDocRef = admin.firestore().collection('users').doc(uid);
    const userDoc = await userDocRef.get();
    const isNewUser = !userDoc.exists;

    const customToken = await admin.auth().createCustomToken(uid);

    return res.status(200).json({ customToken, isNewUser, lineName: verifyData.name || '' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}