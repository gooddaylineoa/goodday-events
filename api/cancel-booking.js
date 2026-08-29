import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        : undefined
    })
  });
}

const adminDb = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST เท่านั้น' });

  const { uid, bookingId, eventId, slotId } = req.body;
  if (!uid || !bookingId || !eventId || !slotId) {
    return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });
  }

  try {
    const bookingRef = adminDb.collection('users').doc(uid).collection('eventBookings').doc(bookingId);
    const eventRef = adminDb.collection('events').doc(eventId);

    await adminDb.runTransaction(async (t) => {
      const bookingDoc = await t.get(bookingRef);
      if (!bookingDoc.exists) throw new Error('ไม่พบการจองนี้');
      if (bookingDoc.data().status !== 'booked') throw new Error('การจองนี้ถูกยกเลิกไปแล้ว หรือใช้งานไปแล้ว');

      const eventDoc = await t.get(eventRef);
      if (eventDoc.exists) {
        const slots = eventDoc.data().slots || [];
        const slotIndex = slots.findIndex(s => s.slotId === slotId);
        if (slotIndex !== -1) {
          const newSlots = [...slots];
          newSlots[slotIndex] = {
            ...newSlots[slotIndex],
            bookedSeats: Math.max(0, newSlots[slotIndex].bookedSeats - 1)
          };
          t.update(eventRef, { slots: newSlots });
        }
      }

      t.update(bookingRef, { status: 'cancelled', cancelledAt: new Date() });
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}