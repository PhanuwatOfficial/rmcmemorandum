const express = require("express")
const line = require("@line/bot-sdk")

const app = express()
app.use(express.json())
app.use(express.static("public"))

const config = {
 channelAccessToken: "b2fh2LSS5Tol02wcgAaglG69RToFh2PBEJ0rmt+2+usd1j9QnOdlo9iQav/mgM9WqTGTfbqPFNGlyy2dc3/4VJge9GCvwHhgPsWNzdk+b+n8/m/wfW91odnR57Y6T32Ibj6i6p3DOv8ujtXzybwdtgdB04t89/1O/w1cDnyilFU=",
 channelSecret: "8b11f8b0519a6b827f6c0c69664cf207"
}

const client = new line.Client(config)

// Firebase Realtime Database (ใช้ REST API แทน Admin SDK)
const FIREBASE_PROJECT_ID = "import-acd62"
const FIREBASE_DB_URL = "https://import-acd62-default-rtdb.asia-southeast1.firebasedatabase.app"

// Firebase Functions เพื่อดึง/บันทึกข้อมูล
async function firebase_set(path, data) {
  try {
    const url = `${FIREBASE_DB_URL}/${path}.json`
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    })
    return await response.json()
  } catch (err) {
    console.error("Firebase set error:", err)
    throw err
  }
}

async function firebase_get(path) {
  try {
    const url = `${FIREBASE_DB_URL}/${path}.json`
    const response = await fetch(url)
    return await response.json()
  } catch (err) {
    console.error("Firebase get error:", err)
    throw err
  }
}

async function firebase_delete(path) {
  try {
    const url = `${FIREBASE_DB_URL}/${path}.json`
    await fetch(url, { method: "DELETE" })
  } catch (err) {
    console.error("Firebase delete error:", err)
    throw err
  }
}

// Webhook Route - รับ events จาก LINE
app.post("/webhook", line.middleware(config), (req, res) => {
  console.log("Webhook received")
  console.log("Events:", JSON.stringify(req.body.events, null, 2))
  
  // ต้อง return 200 เสมอ ไม่ว่าจะเกิด error หรือไม่
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => {
      console.log("Webhook processed successfully")
      res.status(200).json({ ok: true })
    })
    .catch((err) => {
      console.error("Webhook error:", err)
      // ยังคง return 200 เพื่อ prevent LINE retry
      res.status(200).json({ ok: true, error: err.message })
    })
})

// Handle events จาก LINE และเก็บ userId
async function handleEvent(event) {
  try {
    console.log("Handling event:", event.type)
    
    // เมื่อมีคนกด follow
    if (event.type === 'follow') {
      const userId = event.source.userId
      console.log("User followed:", userId)
      try {
        await firebase_set(`followers/${userId}`, {
          userId: userId,
          followedAt: new Date().toISOString(),
          status: 'active'
        })
        console.log("Follower saved successfully:", userId)
      } catch (fbErr) {
        console.error("Firebase save error:", fbErr)
      }
    }

    // เมื่อมีคนกด unfollow
    if (event.type === 'unfollow') {
      const userId = event.source.userId
      console.log("User unfollowed:", userId)
      try {
        await firebase_delete(`followers/${userId}`)
        console.log("Follower removed successfully:", userId)
      } catch (fbErr) {
        console.error("Firebase delete error:", fbErr)
      }
    }

    // เมื่อมีคนส่งข้อความ (บันทึก userId เพิ่มเติม)
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId
      console.log("Message from:", userId, "text:", event.message.text)
      try {
        // เก็บ userId ถ้ายังไม่มี
        const exists = await firebase_get(`followers/${userId}`)
        if (!exists) {
          await firebase_set(`followers/${userId}`, {
            userId: userId,
            firstMessageAt: new Date().toISOString(),
            status: 'active'
          })
          console.log("New follower from message:", userId)
        }
      } catch (fbErr) {
        console.error("Firebase message save error:", fbErr)
      }
    }
  } catch (err) {
    console.error("Handle event error:", err)
  }
}

// Send ให้ USER เดียว (ถ้าส่ง userId ใน request)
app.post("/send", async (req,res)=>{

 const { text, userId } = req.body
 const targetUserId = userId // ใช้ userId จากอีกส่ง, ถ้าไม่มีจะ undefined

 console.log("message =", text, "to userId:", targetUserId)

 try{

  await client.pushMessage(targetUserId,{
   type:"text",
   text:text
  })

  res.json({status:"sent"})

 }catch(err){

 console.log("LINE ERROR FULL:")
 console.log(err)

 if(err.response){
   console.log("LINE RESPONSE:")
   console.log(err.response.data)
 }

 res.status(500).send("error")

}

})

// Broadcast - ส่งให้ทุกคน
app.post("/broadcast", async (req, res) => {
  const { text } = req.body

  if (!text) {
    return res.status(400).json({ error: "text is required" })
  }

  try {
    const followers = await firebase_get("followers")

    if (!followers || typeof followers !== 'object') {
      return res.json({ status: "no followers", successCount: 0, errorCount: 0, totalFollowers: 0 })
    }

    let successCount = 0
    let errorCount = 0

    for (let userId in followers) {
      try {
        await client.pushMessage(userId, {
          type: "text",
          text: text
        })
        successCount++
      } catch (err) {
        console.error(`Error sending to ${userId}:`, err)
        errorCount++
      }
    }

    console.log(`Broadcast complete: ${successCount} sent, ${errorCount} failed`)
    res.json({ 
      status: "broadcast sent",
      successCount: successCount,
      errorCount: errorCount,
      totalFollowers: Object.keys(followers).length
    })
  } catch (err) {
    console.error("Broadcast error:", err)
    res.status(500).json({ error: err.message })
  }
})

// Get followers list
app.get("/followers", async (req, res) => {
  try {
    const followers = await firebase_get("followers")
    
    if (!followers || typeof followers !== 'object') {
      console.log("No followers found in database")
      return res.json({ 
        followers: {},
        count: 0
      })
    }
    
    console.log("Followers retrieved:", Object.keys(followers).length)
    res.json({ 
      followers: followers,
      count: Object.keys(followers).length
    })
  } catch (err) {
    console.error("Get followers error:", err)
    res.status(500).json({ error: err.message })
  }
})

// Test endpoint - เพิ่ม follower สำหรับทดสอบ
app.post("/test-add-follower", async (req, res) => {
  try {
    const testUserId = "Ue78fdf247dea19fe8ef461f8645ef746"
    console.log("Adding test follower:", testUserId)
    
    const result = await firebase_set(`followers/${testUserId}`, {
      userId: testUserId,
      followedAt: new Date().toISOString(),
      status: 'active'
    })
    
    console.log("Firebase response:", result)
    res.json({ status: "Test follower added", userId: testUserId, firebaseResponse: result })
  } catch (err) {
    console.error("Test add follower error:", err)
    res.status(500).json({ error: err.message })
  }
})

// Debug endpoint - ตรวจสอบ Firebase
app.get("/debug", async (req, res) => {
  try {
    console.log("Debug: Attempting to read from Firebase...")
    const followers = await firebase_get("followers")
    console.log("Debug: Firebase response:", followers)
    
    res.json({
      status: "debug",
      firebaseUrl: FIREBASE_DB_URL,
      followersData: followers,
      followersCount: followers && typeof followers === 'object' ? Object.keys(followers).length : 0
    })
  } catch (err) {
    console.error("Debug error:", err)
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

// Check webhook events
app.get("/webhook-test", (req, res) => {
  res.json({
    webhookUrl: "/webhook",
    status: "Webhook setup complete",
    expectingEvents: ["follow", "unfollow", "message"]
  })
})

// View server logs
app.get("/logs", (req, res) => {
  res.json({
    status: "Server running",
    timestamp: new Date().toISOString(),
    firebaseUrl: FIREBASE_DB_URL,
    message: "Check Railway logs for detailed webhook events"
  })
})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
 console.log("server running")
})