/*
ถ้าคุณกำลังทำ **Memorandum Web App (ระบบบันทึก/อนุมัติเอกสาร)** หน้า **Dashboard** ควรถูกออกแบบให้เป็น “control panel” ที่ผู้ใช้เห็นภาพรวม + เข้าถึงงานได้เร็วที่สุด ไม่ใช่แค่แสดงข้อมูลเฉย ๆ แต่ต้องช่วย decision-making ด้วย

ด้านล่างคือโครงสร้างที่ควรมี (จัดตาม best practice ของ workflow system):

---

## 1. ภาพรวม (Overview / KPI Summary)

แสดงสถานะงานแบบ snapshot

* จำนวน Memo ทั้งหมด
* รออนุมัติ (Pending)
* อนุมัติแล้ว (Approved)
* ถูกปฏิเสธ (Rejected)
* งานเร่งด่วน (Urgent)

👉 มักทำเป็น **Card UI** (4–6 กล่องด้านบน)

---

## 2. งานของฉัน (My Tasks)

ส่วนสำคัญที่สุด (user-centric)

* Memo ที่ต้องอนุมัติ
* Memo ที่ user เป็นคนสร้าง
* Memo ที่ถูก assign มาให้

ควรมี:

* ปุ่ม “อนุมัติ / ปฏิเสธ” (quick action)
* แสดง deadline / priority
* filter: วันนี้ / สัปดาห์นี้ / ทั้งหมด

---

## 3. ตารางรายการ Memo (Recent / All Memos)

เป็น core data view

ฟิลด์ที่ควรมี:

* เลขที่เอกสาร
* หัวข้อ (Subject)
* ผู้สร้าง
* แผนก
* วันที่สร้าง
* สถานะ (status)
* ปุ่ม action (ดู / แก้ไข)

👉 เพิ่ม:

* search
* filter (status, department)
* sort (วันที่, ความสำคัญ)

---

## 4. Workflow Status (Visualization)

ช่วยให้เข้าใจ flow

เช่น:

```
Draft → Submitted → Pending → Approved / Rejected
```

สามารถทำเป็น:

* progress bar
* step indicator

---

## 5. Activity / History Log

แสดงการเคลื่อนไหวล่าสุด

* ใครสร้าง memo
* ใครอนุมัติ
* ใคร reject
* เวลา

👉 สำคัญมากสำหรับ audit trail

---

## 6. Notification / Alert

แจ้งเตือนสิ่งสำคัญ

* มี memo ใหม่
* ใกล้ deadline
* ถูก reject

👉 อาจเป็น:

* bell icon
* toast notification

---

## 7. Analytics (Optional แต่แนะนำ)

สำหรับ admin / manager

* จำนวน memo ต่อวัน / เดือน
* อัตราการอนุมัติ vs ปฏิเสธ
* เวลาเฉลี่ยในการอนุมัติ

---

## 8. Quick Actions

ลดจำนวนคลิก

* ➕ สร้าง Memo ใหม่
* 🔍 ค้นหาเอกสาร
* 📥 export (PDF / Excel)

---

## 9. Role-Based View (สำคัญมาก)

Dashboard ต้องเปลี่ยนตาม role เช่น:

### Admin

* เห็นทุก memo
* analytics ครบ

### Approver

* เน้น “Pending Approval”

### User ทั่วไป

* เห็นเฉพาะของตัวเอง

---

## 10. UX ที่ควรใส่เพิ่ม

* Color status (เช่น เขียว = approved, แดง = rejected)
* Badge แสดงจำนวนงานค้าง
* Pagination (คุณเคยทำแล้ว ใช้ต่อได้เลย)
* Responsive (มือถือ)

---

## ตัวอย่าง Layout (แนะนำ)

```
[ KPI Cards ]
[ My Tasks ]   [ Notifications ]

[ Memo Table (ใหญ่) ]

[ Analytics / Charts ]
[ Activity Log ]
```

---

## Insight สำหรับระบบของคุณ (จากที่คุณทำอยู่)

จากระบบ production/workflow ที่คุณเคยทำ:

* คุณควร reuse logic เช่น:

  * productionStatus → memoStatus
  * role-based button (edit/delete) → ใช้กับ approve/reject ได้เลย
* ใช้ dropdown status control เหมือนเดิม จะช่วย consistency

---

ถ้าต้องการต่อ:

* ผมสามารถช่วย **ออกแบบ UI layout (HTML + CSS + JS)** ให้ตรงกับระบบคุณ
* หรือช่วย **mapping database structure (JSON / MongoDB)** สำหรับ memo workflow ได้

คุณอยากไปต่อฝั่งไหน—UI หรือ backend logic?


*/

/*
หน้า memo
1.date
2.ผู้ส่ง/ผู้สร้าง (ชื่อ-นามสกุล ผู้ใช้ที่กำลัง login) "input readonly"


card
1.user ที่ active ในระบบ
2.followers ใน line
3.user ที่รอ approve เพื่อเข้าใช้ระบบ

เมื่อ regis ให้เป็นสถานะ pending 
แล้วให้ admin approve เพื่อเข้าใช้ระบบ
*/

/*
1.เลขที่เอกสาร
2.ให้หน้าอนุมัติ memo ก่อนส่งไปหาฝ่ายอื่น
3.วันที่-เวลา ให้ยึดตามเวลาที่สร้าง memo ไม่ต้องให้เลือก input type date
4.permission 
- เข้าถึง tab user management 
- เข้าถึง system log
- approve/reject memo ก่อนส่งไปฝ่ายอื่น


01/04 
-bug autocomplete (z-index)

log system
login✓
logout✓
register✓
approve user✓

1.memo ที่ถูกส่งไป จะต้องได้รับการ approve ก่อน (ให้กำหนดสิทธิ์ user ที่สามารถ approve ได้ จาก department ,sub-department) เมื่อ approve แล้วจึงจะสามารถส่งต่อไปยังฝ่ายอื่นได้ (ขึ้นแจ้งเตือนไปยัง user นั้นๆที่ได้รับ memo เมื่อ approve แล้ว)
2.เช่นเมื่อกำหนดให้ user A สามารถ approve memo ของ department X ได้ เมื่อ user B ที่อยู่ใน department X ส่ง memo ไป จะต้องรอให้ user A approve ก่อนที่จะส่งต่อไปยังฝ่ายอื่นได้
3.ให้สามารถกำหนดทั้ง department หรือแยก sub-department ได้
4.เพิ่มกำหนดสิทธิ์ แต่ละ user ว่าเข้าถึง tab ไหนได้บ้าง


3/4/26
1.แก้บัค notification
2.บัคเมื่อ unlink user ส่ง memo ไปยัง link user จะไม่แจ้งเตือน line
3.เมื่อส่ง memo ต้องส่งแจ้งเตือน line ให้ผู้ที่ต้อง approve แล้วเมื่อทำการ approve แล้วค่อยแจ้งเตือน line ไปยังผู้รับ memo


4/4/26
เพิ่ม log เมื่อ ส่ง memo

แก้ส่วน Administration ใน tab user management
เมื่อเปิด
-Memo Approvers
-Tab Access Control


        function getEventTypeAndIcon(message, data) {
            const msg = message.toLowerCase()

     
    title: 'User Registered' ✓
    title: 'User Approved' ✓
    title: 'User Rejected' ✓
    title: 'Login' ✓
    title: 'Logout' ✓
    title: 'Sent Memo' ✓
    title: 'Approved Memo'  ✓
    title: 'Rejected Memo' ✓
    title: 'New Follower'
    title: 'Follower Linked'
    title: 'Follower Unlinked'
    title: 'Department Deleted'


*/

