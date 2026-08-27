import { signInWithCustomToken } from 'firebase/auth';
import { auth } from './firebase.js';

const LIFF_ID = '2009970638-fBEb0Yqx'; // 🔴 แทนที่ตรงนี้ด้วย LIFF ID จริงของพี่
const LOGIN_ENDPOINT = '/api/line-login';

export async function initLineAuth() {
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    liff.login();
    return;
  }

  const idToken = liff.getIDToken();
  if (!idToken) {
    console.error('ไม่พบ LIFF ID Token');
    return;
  }

  const res = await fetch(LOGIN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json();

  if (data.customToken) {
    await signInWithCustomToken(auth, data.customToken);
  } else {
    console.error('login ไม่สำเร็จ', data.error);
  }
}