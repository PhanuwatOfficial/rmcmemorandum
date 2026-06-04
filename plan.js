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




06/04
    title: 'User Registered' ✓
    title: 'User Approved' ✓
    title: 'User Rejected' ✓
    title: 'Login' ✓
    title: 'Logout' ✓
    title: 'Sent Memo' ✓
    title: 'Approved Memo'  ✓
    title: 'Rejected Memo' ✓
    title: 'New Follower' ✓
    title: 'Follower Linked'
    title: 'Follower Unlinked'
    title: 'Department Deleted'

-แก้ส่วน Administration ใน tab user management
  เมื่อเปิด tab
  Memo Approvers
  Tab Access Control

-แก้ layout หน้า mobile
-add function | search box
-add function | icon setting topbar


Bug 
-DocNumber ซ้ำกัน (ตอนนี้เมื่อ send memo แล้ว docNumber ไม่ gen ใหม่)



08/04/26

-เพิ่ม upload pic ใน memo ได้ (cloudinary) ✓
-แก้ไขให้ส่ง memo ได้หลาย user ✓
-แก้ไข log ไม่อัพเดท ✓
-คนที่ approve memo ให้ส่ง memo โดยที่ไม่ต้องอนุมัติ ✓
-ทดสอบ setting approver by subdepartment ✓
-add function | icon setting topbar ✓
-แก้ layout หน้า mobile (icon tab)  ✓
-add function | search box ✓

-แก้ไข quick actions
-แก้ layout line message


*/

/*
        function setLanguage(lang) {
            currentLanguage = lang;
            localStorage.setItem("preferredLanguage", lang);

            // Update UI elements
            const currentLang = document.getElementById("currentLang");
            const currentFlag = document.getElementById("currentFlag");

            if (currentLang) {
                currentLang.textContent = lang.toUpperCase();
            }

            if (currentFlag) {
                currentFlag.src = `flags/${lang === 'en' ? 'us' : lang}.png`;
                currentFlag.alt = `${lang.toUpperCase()} flag`;
            }

            // Update translations
            changeLanguage(lang);
            
            // Update emergency contacts table if it exists
            if (typeof renderEmergencyContacts === 'function') {
                renderEmergencyContacts();
            }
        }

        // Add event listener for language buttons
        document.addEventListener('DOMContentLoaded', function () {
            // Add click handlers for language selection buttons
            document.querySelectorAll('[data-lang]').forEach(button => {
                button.addEventListener('click', (e) => {
                    const lang = e.currentTarget.dataset.lang;
                    setLanguage(lang);
                });
            });

            // Set initial language
            const savedLang = localStorage.getItem("preferredLanguage") || "th";
            setLanguage(savedLang);
        });

        function changeLanguage(lang) {
            // currentLanguage = lang;

            // Update all translatable elements
            document.querySelectorAll('[data-translate]').forEach(element => {
                const key = element.dataset.translate;
                if (translations[lang] && translations[lang][key]) {
                    element.textContent = translations[lang][key];
                }
            });

            // Update any placeholders
            document.querySelectorAll('[data-translate-placeholder]').forEach(element => {
                const key = element.dataset.translatePlaceholder;
                if (translations[lang] && translations[lang][key]) {
                    element.placeholder = translations[lang][key];
                }
            });


            // Refresh any dynamic content that needs translation
            if (currentUser) {
                updateDashboard();
                updateNotifications();
            }
        }


*/

/*
1.เพิ่มแปลภาษา
2.แก้ให้ admin ดู sentmemo , receive memo , pending memo ได้ทั้งหมด
3.ให้ admin กดอนุมัติได้ทั้งหมด


17/04
1.เพิ่มแปลภาษา
2.ลบคำที่ไม่จำเป็น
3.เพิ่มขนาด font (ตอนนี้ไทยตัวเล็ก)
*/

/*
<===== RDPROJECT =====>
S -> MD S
MD S -> EN

EN -> MD S
MD S -> S,EN

*/

/*
24/04
-เพิ่มเมื่อ approve เสร็จแล้วให้ผู้รับกดรับทราบว่าได้รับ memo แล้ว ✓
-เพิ่ม ติดตามจัดซื้อ ส่งข้อความ/ไฟล์ - reply (MS teams)
-เพิ่มลายเซ็น (add pic)
*/

/*29/04
-เพิ่มแก้ไขคำ addlog (memo edit , Memo CC sent , R&D project approved (marketing))
-เพิ่มหน้า 2 สำหรับ rdProject
-แก้ไข rd approver ใน receive ขึ้น memo ซ้ำซ้อน (ตรวจสอบ notificationList แต่ละ flow)✓
-เพิ่มให้ add ลายเซ็นได้ (เป็นรูป)
-flow rd แก้ไข form noti ใน line 
-เมื่อผู้อนุมัติ อนุมัติ memo แล้วให้ไปแสดงอยู่ในเมมโมที่ได้รับ✓

*/

/*
06/05
-แก้ไขเมื่อส่ง cc แล้ว เมื่อกด print จะแสดงผลข้อมูลไม่ครบ คือ เรียน(ผู้รับ) ,department ผู้รับ, จาก(ผู้ส่ง) , ส่วน sign footer  ✓
-rawmat แก้ไขคำ addlog ✓
-rawmat เพิ่มแจ้งเตือน line ไปยังผู้รับ ✓

-flow rd แก้ไข form noti ใน line 
-เพิ่มให้ add ลายเซ็นได้ (เป็นรูป)

*/

/*
08/05
-เมื่อส่ง rawmat memo ให้ขึ้น popup ว่าส่งแล้ว✓
-เมื่อผู้อนุมัติ อนุมัติแล้วให้ขึ้นว่าอนุมัติโดยคุณ✓
-บัคถ้า memo ส่งไปเลย (ไม่ต้อง approve) จะไม่ขึ้น  0/1 อ่านแล้ว ✓
-แก้บัค ในตารางไม่มีขึ้นว่า "0/1 อ่านแล้ว" ✓
-แก้ส่วน sign foot ให้แสดงผล ผู้บันทึก,วิศวกร,ผู้อนุมัติ ✓
-แก้ไขบัคถ้าส่งแบบไม่ต้องอนุมัติ จะไม่มีส่วน footer sign (ทั้ง text, pic) ✓
-rawmat memo ให้แจ้งเตือนไปที่ line ผู้อนุมัติด้วย (ก่อน approve) ✓
-แก้ไขบัคเมื่อกำหนด tab แล้วกดตกลง แล้วจะบัค confirm/custom modal✓    


-แก้ไขลายเซ็นให้แสดงผลในครบ ทั้ง memo , rd memo , rawmat memo  
    simple memo✓
    rdproject
    rawmat

01/06
-แก้ไขเมื่อ first approver อนุมัติแล้ว ยังแสดงสถานะให้อนุมัติได้อีก (ใน tab "เมมโมที่ได้รับ" ขึ้นว่ารออนุมัติแล้ว แต่ใน tab "อนุมัติเมมโม" ยังขึ้นรายการให้อนุมัติ)(ต้องให้ second approver อนุมัติ)  ✓ 
-ให้ผู้ที่กำหนดใน rd_project_roles ให้แสดงผล tab "อนุมัติเมมโม" (sidebar) ✓ 
-เมื่อ first approver อนุมัติ จะขึ้นสถานะว่า "รอการอนุมัติ" แต่เกิดบัคเมื่อ rawMatApprover (second/last approver) อนุมัติแล้ว
ใน memo ของ first approver ยังแสดงผลเป็น "รอการอนุมัติ" อยู่ ต้องเปลี่ยนสถานะเป็น "อนุมัติ" ✓ 
-rawmat แก้บัคเมื่อกดรับทราบของผู้รับ (engineer) ผู้ส่งขึ้น1/1 แต่ของ approver ไม่แสดงผล ✓
-แก้ไขบัคผู้รับ rawmat memo (engineer) กดปุ่มรับทราบแล้ว ปุ่มรับทราบยังอยู่ไม่หายไป (น่าจะเป็นเพราะตอนนี้ engineer role="admin" แต่พอเปลี่ยน engineer เป็น role = user จะแสดงผล "รับทราบแล้ว" ปกติ)✓
-rawmat test ตรงแจ้งเตือน (แก้ไข notificationList ของผู้ที่ทำการส่ง rawmat memo) ✓ 
-test การแจ้งเตือน line ทุก row (raw matt) first approver✓ / last approver ✓ / engineer ✓ / creater (approved succesfuly)✓  
-แก้ไขลายเซ็น rawmat (ผู้ส่ง , ผู้อนุมัติ (1) , ผู้อนุมัติ (2) (วิศวกร,ผู้รับไม่ต้อง)) ✓
-แก้ไข text addlog rawmatt ✓
-แก้ไขคำในแชท line notification rawmat (✓ Ready for Second Approval) ✓
-บัคส่ง memo หลายคน (ส่ง recipent link,unlink ใน docid เดียวกัน จะกลายเป็น seperate) ✓
-เพิ่มตอบกลับเมื่อคลิก acknowledge (feedback) ✓

ทำการ test ทุก memo type (memo ปกติ ✓ / rawmat memo ✓ / rdproject memo)
-บัค feedback ไปแสดงผลใน overlay modal อื่นด้วย





*/