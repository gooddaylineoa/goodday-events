import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

const adminDb = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'ใช้ได้เฉพาะ POST เท่านั้น' });

  const { uid, eventId, slotId } = req.body;
  if (!uid || !eventId || !slotId) return res.status(400).json({ error: 'ข้อมูลไม่ครบ' });

  try {
    const eventRef = adminDb.collection('events').doc(eventId);

    const result = await adminDb.runTransaction(async (t) => {
      const eventDoc = await t.get(eventRef);
      if (!eventDoc.exists) throw new Error('ไม่พบกิจกรรมนี้');
      const eventData = eventDoc.data();
      const slots = eventData.slots || [];
      const slotIndex = slots.findIndex(s => s.slotId === slotId);
      if (slotIndex === -1) throw new Error('ไม่พบรอบเวลานี้');

      const slot = slots[slotIndex];

      if (slot.bookedSeats >= slot.totalSeats) {
        throw new Error('ขออภัย ที่นั่งเต็มแล้ว');
      }

      const slotDateTime = new Date(`${slot.date}T${slot.startTime}:00`);
      const cutoff = new Date(slotDateTime.getTime() - 10 * 60000);
      if (new Date() >= cutoff) {
        throw new Error('เลยเวลาที่สามารถจองได้แล้ว (ต้องจองก่อนเริ่มกิจกรรมอย่างน้อย 10 นาที)');
      }

      const newSlots = [...slots];
      newSlots[slotIndex] = { ...slot, bookedSeats: slot.bookedSeats + 1 };
      t.update(eventRef, { slots: newSlots });

      return { eventName: eventData.name, slot };
    });

    const bookingCode = Math.floor(100000 + Math.random() * 900000).toString();
    const bookingRef = adminDb.collection('users').doc(uid).collection('eventBookings').doc();

    await bookingRef.set({
      eventId,
      eventName: result.eventName,
      slotId,
      slotDate: result.slot.date,
      slotTime: `${result.slot.startTime}-${result.slot.endTime}`,
      bookingCode,
      status: 'booked',
      createdAt: Timestamp.now()
    });

    return res.status(200).json({ success: true, bookingId: bookingRef.id, bookingCode });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}