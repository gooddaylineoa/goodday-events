import { auth, db } from './firebase.js';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, getDocs, collection, query, orderBy, addDoc, serverTimestamp } from 'firebase/firestore';
import { initLineAuth } from './lineAuth.js';

// --- Toast แจ้งเตือน ---
function showToast(message, type = 'info', duration = 3200) {
  const container = document.getElementById('toast-container');
  const colors = { success: 'bg-emerald-500', error: 'bg-rose-500', info: 'bg-blue-500' };
  const toast = document.createElement('div');
  toast.className = `${colors[type] || colors.info} text-white rounded-2xl shadow-lg px-4 py-3.5 text-base font-bold`;
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}
window.showToast = showToast;

// --- สลับหน้า ---
function showView(id) {
  document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
window.showView = showView;

let currentUid = null;
let userAgeForEvents = null;
let userProvinceForEvents = null;

document.getElementById('btn-go-register').onclick = () => {
  window.location.href = 'https://goodday-member-system.vercel.app';
};

// --- เช็คสถานะ login ---
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUid = user.uid;
    const snap = await getDoc(doc(db, 'users', currentUid));
    const data = snap.exists() ? snap.data() : null;

    if (!data || !data.profileComplete) {
      showView('not-member-view');
      return;
    }

    userAgeForEvents = calcAgeFromBirthdate(data.birthdate);
    userProvinceForEvents = data.address ? data.address.prov : null;
    showView('events-view');
    await loadEventsData();
  } else {
    currentUid = null;
    await initLineAuth();
  }
});

// --- คำนวณอายุจาก birthdate ---
function calcAgeFromBirthdate(birthdateStr) {
  if (!birthdateStr) return null;
  let year, month = 0, day = 1;

  if (birthdateStr.includes('-')) {
    const [y, m, d] = birthdateStr.split('-').map(Number);
    year = y; month = m - 1; day = d;
  } else if (birthdateStr.includes('/')) {
    const [m, d, y] = birthdateStr.split('/').map(Number);
    year = y; month = m - 1; day = d;
    if (year > 2400) year -= 543;
  } else {
    return null;
  }

  const bd = new Date(year, month, day);
  const today = new Date();
  let age = today.getFullYear() - bd.getFullYear();
  const mDiff = today.getMonth() - bd.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < bd.getDate())) age--;
  return age;
}

function isEventEligible(event, userAge, userProvince) {
  const provinceOk = event.province === 'all' || event.province === userProvince;
  const minOk = !event.minAge || userAge === null || userAge >= event.minAge;
  const maxOk = !event.maxAge || userAge === null || userAge <= event.maxAge;
  return provinceOk && minOk && maxOk;
}

let allEventsData = [];
let currentEventCategory = 'all';
let currentEventProvinceFilter = 'mine';

const eventCategories = [
  { id: 'all', label: 'ทั้งหมด', icon: 'fa-border-all' },
  { id: 'health', label: 'สุขภาพ', icon: 'fa-person-walking' },
  { id: 'workshop', label: 'เวิร์คช็อป', icon: 'fa-seedling' },
  { id: 'community', label: 'พื้นที่ทำดี', icon: 'fa-heart' }
];

function renderCategoryTabs() {
  document.getElementById('ev-category-tabs').innerHTML = eventCategories.map(c => `
    <button data-cat="${c.id}" class="ev-cat-btn shrink-0 px-4 py-2.5 rounded-full text-base font-bold flex items-center gap-2 border-2 ${currentEventCategory === c.id ? 'theme-pink text-white border-transparent' : 'bg-white text-gray-600 border-gray-200'}">
      <i class="fa-solid ${c.icon}"></i> ${c.label}
    </button>
  `).join('');

  document.querySelectorAll('.ev-cat-btn').forEach(btn => {
    btn.onclick = () => {
      currentEventCategory = btn.dataset.cat;
      renderCategoryTabs();
      renderEventList();
    };
  });
}

function updateProvinceFilterButtons() {
  const mineBtn = document.getElementById('ev-filter-mine');
  const allBtn = document.getElementById('ev-filter-all');
  if (currentEventProvinceFilter === 'mine') {
    mineBtn.className = 'flex-1 py-2.5 rounded-xl text-base font-bold border-2 theme-pink text-white border-transparent';
    allBtn.className = 'flex-1 py-2.5 rounded-xl text-base font-bold border-2 bg-white text-gray-600 border-gray-200';
  } else {
    allBtn.className = 'flex-1 py-2.5 rounded-xl text-base font-bold border-2 theme-pink text-white border-transparent';
    mineBtn.className = 'flex-1 py-2.5 rounded-xl text-base font-bold border-2 bg-white text-gray-600 border-gray-200';
  }
}
document.getElementById('ev-filter-mine').onclick = () => { currentEventProvinceFilter = 'mine'; updateProvinceFilterButtons(); renderEventList(); };
document.getElementById('ev-filter-all').onclick = () => { currentEventProvinceFilter = 'all'; updateProvinceFilterButtons(); renderEventList(); };
document.getElementById('ev-search').oninput = () => renderEventList();

async function loadEventsData() {
  renderCategoryTabs();
  updateProvinceFilterButtons();

  const container = document.getElementById('ev-list-container');
  container.innerHTML = '<p class="text-center text-gray-400 text-lg py-8">กำลังโหลดกิจกรรม...</p>';

  const snap = await getDocs(collection(db, 'events'));
  allEventsData = [];
  snap.forEach(d => allEventsData.push({ id: d.id, ...d.data() }));

  renderEventList();
}

function renderEventList() {
  const container = document.getElementById('ev-list-container');
  const searchTerm = document.getElementById('ev-search').value.trim().toLowerCase();

  let filtered = allEventsData.filter(ev => {
    if (currentEventCategory !== 'all' && ev.category !== currentEventCategory) return false;
    if (currentEventProvinceFilter === 'mine' && ev.province !== 'all' && ev.province !== userProvinceForEvents) return false;
    if (searchTerm && !ev.name.toLowerCase().includes(searchTerm)) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-center text-gray-400 text-lg py-8">ไม่พบกิจกรรมที่ตรงเงื่อนไข</p>';
    return;
  }

  container.innerHTML = filtered.map(ev => {
    const eligible = isEventEligible(ev, userAgeForEvents, userProvinceForEvents);
    const totalSeats = (ev.slots || []).reduce((sum, s) => sum + (s.totalSeats - s.bookedSeats), 0);
    const ageLabel = (!ev.minAge && !ev.maxAge) ? 'ไม่จำกัดอายุ' : `อายุ ${ev.minAge || 0}-${ev.maxAge || '∞'} ปี`;

    return `
      <div class="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
        <img src="${ev.image}" class="w-full h-40 object-cover">
        <div class="p-4">
          <div class="flex justify-between items-start mb-2">
            <h3 class="font-black text-gray-800 text-lg leading-tight">${ev.name}</h3>
            <span class="bg-pink-50 theme-text text-sm font-bold px-2.5 py-1 rounded-full shrink-0 ml-2">ว่าง ${totalSeats} ที่</span>
          </div>
          <p class="text-gray-500 text-base mb-1"><i class="fa-regular fa-calendar mr-1"></i> ${ev.slots && ev.slots[0] ? ev.slots[0].date : '-'}</p>
          <p class="text-gray-500 text-base mb-3"><i class="fa-solid fa-location-dot mr-1"></i> ${ev.location}</p>
          <span class="inline-block text-sm font-bold px-2.5 py-1 rounded-full mb-3 ${eligible ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}">
            <i class="fa-solid fa-user mr-1"></i> ${ageLabel}
          </span>
          <button onclick="${eligible ? `openEventDetail('${ev.id}')` : `showToast('กิจกรรมนี้ไม่ตรงเงื่อนไขอายุของคุณ', 'error')`}"
            class="w-full ${eligible ? 'theme-pink' : 'bg-gray-300'} text-white text-lg font-bold py-3 rounded-xl">
            ${eligible ? 'จองที่นั่ง' : 'ไม่ตรงเงื่อนไข'}
          </button>
        </div>
      </div>`;
  }).join('');
}

// --- แถบเมนูล่าง 3 แถบ ---
function setEventTab(tab) {
  document.querySelectorAll('#ev-tab-events, #ev-tab-calendar, #ev-tab-history').forEach(b => {
    b.classList.remove('theme-text');
    b.classList.add('text-gray-400');
  });
  document.getElementById(`ev-tab-${tab}`).classList.remove('text-gray-400');
  document.getElementById(`ev-tab-${tab}`).classList.add('theme-text');
}
document.getElementById('ev-tab-events').onclick = () => { setEventTab('events'); showView('events-view'); };
document.getElementById('ev-tab-calendar').onclick = () => {
  setEventTab('calendar');
  showView('events-calendar-view');
  renderCalendar();
};
document.getElementById('ev-tab-history').onclick = () => { setEventTab('history'); showView('events-history-view'); };

// --- Loading overlay ---
function showLoading(msg = 'กำลังประมวลผล...') {
  document.getElementById('loading-text').innerText = msg;
  const el = document.getElementById('loading-overlay');
  el.classList.remove('hidden');
  el.classList.add('flex');
}
function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.classList.add('hidden');
  el.classList.remove('flex');
}

let currentEventDetail = null;
let selectedSlotId = null;

function openEventDetail(eventId) {
  const ev = allEventsData.find(e => e.id === eventId);
  if (!ev) return;
  currentEventDetail = ev;
  selectedSlotId = null;

  document.getElementById('ed-image').src = ev.image;
  document.getElementById('ed-title').innerText = ev.name;
  document.getElementById('ed-desc').innerText = ev.description || '';
  document.getElementById('ed-map-link').href = ev.mapLink || '#';

  const fileLink = document.getElementById('ed-file-link');
  if (ev.projectFileUrl) {
    fileLink.href = ev.projectFileUrl;
    fileLink.classList.remove('hidden');
  } else {
    fileLink.classList.add('hidden');
  }

  renderSlots(ev);
  document.getElementById('btn-confirm-booking').disabled = true;
  document.getElementById('btn-confirm-booking').className = 'w-full bg-gray-300 text-white py-4 rounded-2xl font-black text-xl';
  document.getElementById('ed-error').classList.add('hidden');

  showView('event-detail-view');
}
window.openEventDetail = openEventDetail;

function isSlotBookable(slot) {
  const now = new Date();
  const slotStart = new Date(`${slot.date}T${slot.startTime}:00`);
  const cutoff = new Date(slotStart.getTime() - 10 * 60000);
  const seatsLeft = slot.totalSeats - slot.bookedSeats;
  return now < cutoff && seatsLeft > 0;
}

function renderSlots(ev) {
  const container = document.getElementById('ed-slots-container');
  container.innerHTML = (ev.slots || []).map(slot => {
    const seatsLeft = slot.totalSeats - slot.bookedSeats;
    const bookable = isSlotBookable(slot);
    return `
      <label class="block ${bookable ? 'cursor-pointer' : 'opacity-50'}">
        <div class="flex items-center justify-between border-2 rounded-2xl p-4 slot-option" data-slot-id="${slot.slotId}">
          <div class="flex items-center gap-3">
            <input type="radio" name="ev-slot" value="${slot.slotId}" ${bookable ? '' : 'disabled'} class="w-5 h-5">
            <div>
              <p class="text-lg font-bold text-gray-800">${slot.date} | ${slot.startTime}-${slot.endTime}</p>
              <p class="text-base text-gray-400">${bookable ? '' : (seatsLeft <= 0 ? 'ที่นั่งเต็ม' : 'ปิดรับจองแล้ว')}</p>
            </div>
          </div>
          <span class="text-base font-bold px-3 py-1.5 rounded-full ${seatsLeft > 0 ? 'bg-pink-50 theme-text' : 'bg-gray-100 text-gray-400'}">ว่าง ${Math.max(seatsLeft, 0)}</span>
        </div>
      </label>`;
  }).join('');

  document.querySelectorAll('input[name="ev-slot"]').forEach(radio => {
    radio.onchange = (e) => {
      selectedSlotId = e.target.value;
      document.querySelectorAll('.slot-option').forEach(el => el.classList.remove('border-pink-500'));
      e.target.closest('.slot-option').classList.add('border-pink-500');

      const btn = document.getElementById('btn-confirm-booking');
      btn.disabled = false;
      btn.className = 'w-full theme-pink text-white py-4 rounded-2xl font-black text-xl';
    };
  });
}

document.getElementById('btn-back-ev-detail').onclick = () => showView('events-view');

document.getElementById('btn-confirm-booking').onclick = async () => {
  if (!selectedSlotId || !currentEventDetail) return;
  const errBox = document.getElementById('ed-error');
  errBox.classList.add('hidden');

  showLoading('กำลังจองที่นั่ง...');
  try {
    const res = await fetch('/api/book-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: currentUid, eventId: currentEventDetail.id, slotId: selectedSlotId })
    });
    const data = await res.json();

    if (!res.ok) {
      hideLoading();
      errBox.innerText = data.error || 'จองไม่สำเร็จ กรุณาลองใหม่';
      errBox.classList.remove('hidden');
      return;
    }

    hideLoading();
    document.getElementById('bs-event-name').innerText = currentEventDetail.name;
    document.getElementById('bs-code').innerText = data.bookingCode;

    const qrPayload = `${currentUid}|${data.bookingId}`;
    document.getElementById('bs-qr').src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrPayload)}`;

    showView('booking-success-view');
  } catch (err) {
    hideLoading();
    errBox.innerText = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
    errBox.classList.remove('hidden');
  }
};

document.getElementById('btn-booking-done').onclick = async () => {
  showView('events-view');
  await loadEventsData(); // โหลดใหม่ให้เห็นที่นั่งอัปเดต
};

// ================= ปฏิทินกิจกรรม =================

let calCurrentMonth = new Date().getMonth();
let calCurrentYear = new Date().getFullYear();
let calSelectedDate = null;

const thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function formatDateKey(y, m, d) {
  const mm = String(m + 1).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

// รวมวันที่ทั้งหมดที่มีกิจกรรม จาก allEventsData (ใช้ตัวแปรร่วมกับหน้ากิจกรรมที่มีอยู่แล้ว)
function getEventDatesSet() {
  const dates = new Set();
  allEventsData.forEach(ev => {
    (ev.slots || []).forEach(slot => dates.add(slot.date));
  });
  return dates;
}

function renderCalendar() {
  document.getElementById('cal-month-label').innerText = `${thaiMonths[calCurrentMonth]} ${calCurrentYear + 543}`;

  const firstDay = new Date(calCurrentYear, calCurrentMonth, 1).getDay(); // 0=อาทิตย์
  const daysInMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
  const eventDates = getEventDatesSet();
  const todayKey = formatDateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  let html = '';
  for (let i = 0; i < firstDay; i++) {
    html += `<div></div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = formatDateKey(calCurrentYear, calCurrentMonth, d);
    const hasEvent = eventDates.has(key);
    const isToday = key === todayKey;
    const isSelected = key === calSelectedDate;

    let cellClass = 'w-full aspect-square rounded-xl flex flex-col items-center justify-center text-base font-bold cursor-pointer relative';
    if (isSelected) cellClass += ' theme-pink text-white';
    else if (isToday) cellClass += ' bg-pink-50 theme-text border-2 border-pink-300';
    else cellClass += ' text-gray-700 hover:bg-gray-50';

    html += `
      <div class="${cellClass}" data-date="${key}" onclick="selectCalendarDate('${key}')">
        ${d}
        ${hasEvent ? `<span class="absolute bottom-1.5 w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-pink-500'}"></span>` : ''}
      </div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
}

document.getElementById('cal-prev-month').onclick = () => {
  calCurrentMonth--;
  if (calCurrentMonth < 0) { calCurrentMonth = 11; calCurrentYear--; }
  renderCalendar();
};
document.getElementById('cal-next-month').onclick = () => {
  calCurrentMonth++;
  if (calCurrentMonth > 11) { calCurrentMonth = 0; calCurrentYear++; }
  renderCalendar();
};

function selectCalendarDate(dateKey) {
  calSelectedDate = dateKey;
  renderCalendar();
  renderCalendarEventsList(dateKey);
}
window.selectCalendarDate = selectCalendarDate;

function renderCalendarEventsList(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  document.getElementById('cal-selected-date-label').innerText = `กิจกรรมวันที่ ${d} ${thaiMonths[m - 1]} ${y + 543}`;

  const container = document.getElementById('cal-events-list');
  const matched = allEventsData.filter(ev => (ev.slots || []).some(s => s.date === dateKey));

  if (matched.length === 0) {
    container.innerHTML = '<p class="text-center text-gray-400 text-base py-8">ไม่มีกิจกรรมในวันนี้</p>';
    return;
  }

  container.innerHTML = matched.map(ev => {
    const eligible = isEventEligible(ev, userAgeForEvents, userProvinceForEvents);
    const slotForDay = (ev.slots || []).find(s => s.date === dateKey);
    return `
      <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4 cursor-pointer" onclick="${eligible ? `openEventDetail('${ev.id}')` : `showToast('กิจกรรมนี้ไม่ตรงเงื่อนไขอายุของคุณ', 'error')`}">
        <img src="${ev.image}" class="w-16 h-16 rounded-xl object-cover shrink-0">
        <div class="flex-1">
          <h4 class="font-black text-gray-800 text-base leading-tight mb-1">${ev.name}</h4>
          <p class="text-sm text-gray-400"><i class="fa-regular fa-clock mr-1"></i>${slotForDay.startTime}-${slotForDay.endTime}</p>
        </div>
        <i class="fa-solid fa-chevron-right text-gray-300"></i>
      </div>`;
  }).join('');
}

// แถบเมนูล่างของหน้าปฏิทิน (สลับกลับไปหน้าอื่น)
document.getElementById('cal-tab-events').onclick = () => { showView('events-view'); setEventTab('events'); };
document.getElementById('cal-tab-calendar').onclick = () => { showView('events-calendar-view'); };
document.getElementById('cal-tab-history').onclick = () => { showView('events-history-view'); setEventTab('history'); };

// ================= ประวัติการจอง =================

let allBookingsData = [];
let currentBookingDetail = null;

document.getElementById('hist-tab-events').onclick = () => { showView('events-view'); setEventTab('events'); };
document.getElementById('hist-tab-calendar').onclick = () => { showView('events-calendar-view'); renderCalendar(); };
document.getElementById('hist-tab-history').onclick = () => { showView('events-history-view'); };

document.getElementById('ev-tab-history').onclick = () => {
  setEventTab('history');
  showView('events-history-view');
  loadBookingHistory();
};

async function loadBookingHistory() {
  const container = document.getElementById('hist-list-container');
  container.innerHTML = '<p class="text-center text-gray-400 text-lg py-8">กำลังโหลด...</p>';

  const q = query(collection(db, 'users', currentUid, 'eventBookings'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);

  allBookingsData = [];
  snap.forEach(d => allBookingsData.push({ id: d.id, ...d.data() }));

  // สรุปสถิติ (นับเฉพาะที่ไม่ได้ยกเลิก)
  const activeBookings = allBookingsData.filter(b => b.status !== 'cancelled');
  document.getElementById('hist-total-count').innerText = activeBookings.length;
  const uniqueCategories = new Set(activeBookings.map(b => b.eventCategory).filter(Boolean));
  document.getElementById('hist-category-count').innerText = uniqueCategories.size;

  if (allBookingsData.length === 0) {
    container.innerHTML = '<p class="text-center text-gray-400 text-lg py-8">ยังไม่มีประวัติการจอง</p>';
    return;
  }

  const statusLabel = { booked: 'จองแล้ว', cancelled: 'ยกเลิกแล้ว', attended: 'เข้าร่วมแล้ว' };
  const statusColor = { booked: 'bg-emerald-50 text-emerald-600', cancelled: 'bg-gray-100 text-gray-400', attended: 'bg-blue-50 text-blue-600' };

  container.innerHTML = allBookingsData.map(b => `
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4 cursor-pointer" onclick="openBookingDetail('${b.id}')">
      <img src="${b.eventImage || ''}" class="w-16 h-16 rounded-xl object-cover shrink-0 bg-gray-100">
      <div class="flex-1">
        <h4 class="font-black text-gray-800 text-base leading-tight mb-1">${b.eventName}</h4>
        <p class="text-sm text-gray-400">${b.slotDate} | ${b.slotTime}</p>
      </div>
      <span class="text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${statusColor[b.status] || ''}">${statusLabel[b.status] || b.status}</span>
    </div>
  `).join('');
}

function isEventPast(slotDate, slotTime) {
  const endTime = slotTime.split('-')[1]; // เช่น "18:00"
  const eventEnd = new Date(`${slotDate}T${endTime}:00`);
  return new Date() > eventEnd;
}

function openBookingDetail(bookingId) {
  const b = allBookingsData.find(x => x.id === bookingId);
  if (!b) return;
  currentBookingDetail = b;

  document.getElementById('bd-image').src = b.eventImage || '';
  document.getElementById('bd-title').innerText = b.eventName;
  document.getElementById('bd-desc').innerText = b.eventDescription || '';
  document.getElementById('bd-datetime').innerText = `${b.slotDate} | ${b.slotTime}`;
  document.getElementById('bd-location').innerText = b.eventLocation || '-';
  document.getElementById('bd-map-link').href = b.eventMapLink || '#';

  const fileLink = document.getElementById('bd-file-link');
  if (b.eventProjectFileUrl) {
    fileLink.href = b.eventProjectFileUrl;
    fileLink.classList.remove('hidden');
  } else {
    fileLink.classList.add('hidden');
  }

  const statusLabel = { booked: 'จองแล้ว', cancelled: 'ยกเลิกแล้ว', attended: 'เข้าร่วมแล้ว' };
  const statusColor = { booked: 'bg-emerald-50 text-emerald-600', cancelled: 'bg-gray-100 text-gray-400', attended: 'bg-blue-50 text-blue-600' };
  const badge = document.getElementById('bd-status-badge');
  badge.innerText = statusLabel[b.status] || b.status;
  badge.className = `inline-block text-sm font-bold px-3 py-1.5 rounded-full mb-3 ${statusColor[b.status] || ''}`;

  const qrBox = document.getElementById('bd-qr-box');
  const cancelBtn = document.getElementById('btn-cancel-booking');
  const feedbackBtn = document.getElementById('btn-give-feedback');
  const isPast = isEventPast(b.slotDate, b.slotTime);

  if (b.status === 'booked') {
    document.getElementById('bd-code').innerText = b.bookingCode;
    document.getElementById('bd-qr').src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(currentUid + '|' + b.id)}`;
    qrBox.classList.remove('hidden');
    cancelBtn.classList.toggle('hidden', isPast);
    feedbackBtn.classList.toggle('hidden', !isPast);
  } else {
    qrBox.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    feedbackBtn.classList.toggle('hidden', !(isPast && b.status !== 'cancelled'));
  }

  showView('booking-detail-view');
}
window.openBookingDetail = openBookingDetail;

document.getElementById('btn-back-booking-detail').onclick = () => showView('events-history-view');

document.getElementById('btn-cancel-booking').onclick = async () => {
  if (!currentBookingDetail) return;
  if (!confirm('ยืนยันยกเลิกการจองนี้หรือไม่? ที่นั่งจะถูกคืนให้กิจกรรม')) return;

  showLoading('กำลังยกเลิกการจอง...');
  try {
    const res = await fetch('/api/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: currentUid,
        bookingId: currentBookingDetail.id,
        eventId: currentBookingDetail.eventId,
        slotId: currentBookingDetail.slotId
      })
    });
    const data = await res.json();
    hideLoading();

    if (!res.ok) {
      showToast(data.error || 'ยกเลิกไม่สำเร็จ', 'error');
      return;
    }

    showToast('ยกเลิกการจองสำเร็จ', 'success');
    showView('events-history-view');
    await loadBookingHistory();
  } catch (err) {
    hideLoading();
    showToast('เกิดข้อผิดพลาด กรุณาลองใหม่', 'error');
  }
};

// --- ฟอร์ม Feedback ---
let selectedRating = 0;

document.getElementById('btn-give-feedback').onclick = () => {
  document.getElementById('fb-event-name').innerText = currentBookingDetail.eventName;
  document.getElementById('fb-comment').value = '';
  document.getElementById('fb-error').classList.add('hidden');
  selectedRating = 0;
  renderFeedbackStars();
  showView('feedback-form-view');
};

document.getElementById('btn-back-feedback').onclick = () => showView('booking-detail-view');

function renderFeedbackStars() {
  const container = document.getElementById('fb-rating-stars');
  container.innerHTML = [1, 2, 3, 4, 5].map(n => `
    <button data-star="${n}" class="fb-star-btn text-4xl ${n <= selectedRating ? 'text-amber-400' : 'text-gray-200'}">
      <i class="fa-solid fa-star"></i>
    </button>
  `).join('');

  document.querySelectorAll('.fb-star-btn').forEach(btn => {
    btn.onclick = () => {
      selectedRating = Number(btn.dataset.star);
      renderFeedbackStars();
    };
  });
}

document.getElementById('btn-submit-feedback').onclick = async () => {
  const errBox = document.getElementById('fb-error');
  if (selectedRating === 0) {
    errBox.innerText = 'กรุณาให้คะแนนความพึงพอใจก่อน';
    errBox.classList.remove('hidden');
    return;
  }

  showLoading('กำลังส่งความคิดเห็น...');
  try {
    await addDoc(collection(db, 'users', currentUid, 'eventFeedback'), {
      bookingId: currentBookingDetail.id,
      eventId: currentBookingDetail.eventId,
      eventName: currentBookingDetail.eventName,
      rating: selectedRating,
      comment: document.getElementById('fb-comment').value.trim(),
      createdAt: serverTimestamp()
    });
    hideLoading();
    showToast('ขอบคุณสำหรับความคิดเห็น!', 'success');
    showView('events-history-view');
  } catch (err) {
    hideLoading();
    errBox.innerText = 'เกิดข้อผิดพลาด: ' + err.message;
    errBox.classList.remove('hidden');
  }
};

