import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// ตั้งค่า Firebase Admin แค่ครั้งเดียว (กันการรันซ้ำ)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

const adminAuth = getAuth();
const adminDb = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST เท่านั้น' });
  }

  const { idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'ไม่พบ idToken' });
  }

  try {
    // ขั้นที่ 1: ส่ง idToken ไปให้ LINE ตรวจสอบว่าเป็นของจริง ไม่ได้ปลอมมา
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

    // ขั้นที่ 2: ใช้ LINE user id (sub) มาสร้าง uid ของ Firebase แบบคงที่
    const lineUserId = verifyData.sub;
    const uid = `line_${lineUserId}`;

    // ขั้นที่ 3: เช็คว่าเคยมีบัญชีนี้ใน Firestore หรือยัง
    const userDocRef = adminDb.collection('users').doc(uid);
    const userDoc = await userDocRef.get();
    const isNewUser = !userDoc.exists;

    // ขั้นที่ 4: ออก "ตั๋วเข้า Firebase" (Custom Token) ให้ uid นี้
    const customToken = await adminAuth.createCustomToken(uid);

    return res.status(200).json({
      customToken,
      isNewUser,
      lineName: verifyData.name || ''
    });
  } catch (err) {
    console.error('LINE login error:', err);
    return res.status(500).json({ error: err.message });
  }
}