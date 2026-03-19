const express = require("express")
const line = require("@line/bot-sdk")
const crypto = require("crypto")

const app = express()
// Webhook ต้องใช้ raw body สำหรับ signature validation
// อื่นๆ ใช้ JSON
app.use((req, res, next) => {
  if (req.path === '/webhook') {
    express.raw({ type: 'application/json' })(req, res, next)
  } else {
    express.json()(req, res, next)
  }
})
app.use(express.static("public"))

// Logger System
let logs = [] // เก็บ logs ชั่วคราว
const MAX_LOGS = 1000 // เก็บ max 1000 logs

function addLog(level, message, data = null) {
  const timestamp = new Date().toISOString()
  const logEntry = {
    timestamp,
    level,
    message,
    data
  }
  logs.push(logEntry)
  
  // เก็บ max 1000 logs
  if (logs.length > MAX_LOGS) {
    logs.shift()
  }
  
  // บันทึก log ลงใน Firebase
  firebase_set(`logs/${Date.now()}`, logEntry).catch(err => {
    // ถ้า Firebase error ก็ไม่ต้อง crash
  })
  
  // พิมพ์ออกมา
  const prefix = `[${level.toUpperCase()}] ${timestamp}`
  if (level === 'error') {
    console.error(`${prefix}: ${message}`, data)
  } else {
    console.log(`${prefix}: ${message}`, data || '')
  }
}

const config = {
 channelAccessToken: "b2fh2LSS5Tol02wcgAaglG69RToFh2PBEJ0rmt+2+usd1j9QnOdlo9iQav/mgM9WqTGTfbqPFNGlyy2dc3/4VJge9GCvwHhgPsWNzdk+b+n8/m/wfW91odnR57Y6T32Ibj6i6p3DOv8ujtXzybwdtgdB04t89/1O/w1cDnyilFU=",
 channelSecret: "8b11f8b0519a6b827f6c0c69664cf207"
}

const client = new line.Client(config)

// Firebase Realtime Database (ใช้ REST API แทน Admin SDK)
const FIREBASE_PROJECT_ID = "line-6191d"
// const FIREBASE_DB_URL = "https://import-acd62-default-rtdb.asia-southeast1.firebasedatabase.app"
const FIREBASE_DB_URL = "https://line-6191d-default-rtdb.asia-southeast1.firebasedatabase.app"

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
    addLog('error', 'Firebase set error', { path, message: err.message })
    throw err
  }
}

async function firebase_get(path) {
  try {
    const url = `${FIREBASE_DB_URL}/${path}.json`
    const response = await fetch(url)
    return await response.json()
  } catch (err) {
    addLog('error', 'Firebase get error', { path, message: err.message })
    throw err
  }
}

async function firebase_delete(path) {
  try {
    const url = `${FIREBASE_DB_URL}/${path}.json`
    await fetch(url, { method: "DELETE" })
  } catch (err) {
    addLog('error', 'Firebase delete error', { path, message: err.message })
    throw err
  }
}

// Webhook Route - รับ events จาก LINE
app.post("/webhook", async (req, res) => {
  try {
    const signature = req.get('x-line-signature')
    const body = req.body
    
    // body ควรเป็น Buffer เมื่อใช้ express.raw()
    let bodyString
    if (Buffer.isBuffer(body)) {
      bodyString = body.toString('utf-8')
    } else if (typeof body === 'string') {
      bodyString = body
    } else {
      bodyString = JSON.stringify(body)
    }
    
    // ตรวจสอบ signature
    const hmac = crypto.createHmac('sha256', config.channelSecret)
    hmac.update(bodyString)
    const hash = hmac.digest('base64')
    
    if (signature !== hash) {
      addLog('warn', 'Signature validation failed', { expected: hash, got: signature })
      return res.status(403).json({ error: 'Invalid signature' })
    }
    
    addLog('info', 'Webhook received - Signature valid')
    // parse JSON body
    const events = JSON.parse(bodyString).events
    addLog('info', 'Events received', { count: events.length })
    
    await Promise.all(events.map(handleEvent))
    
    addLog('info', 'Webhook processed successfully')
    res.status(200).json({ ok: true })
  } catch (err) {
    addLog('error', 'Webhook error', { message: err.message })
    res.status(200).json({ ok: true, error: err.message })
  }
})

// Handle events จาก LINE และเก็บ userId
async function handleEvent(event) {
  try {
    addLog('info', 'Handling event', { type: event.type })
    
    // เมื่อมีคนกด follow
    if (event.type === 'follow') {
      const userId = event.source.userId
      addLog('info', 'User followed', { userId })
      try {
        await firebase_set(`followers/${userId}`, {
          userId: userId,
          followedAt: new Date().toISOString(),
          status: 'active'
        })
        addLog('info', 'Follower saved successfully', { userId })
      } catch (fbErr) {
        addLog('error', 'Firebase save error', { message: fbErr.message })
      }
    }

    // เมื่อมีคนกด unfollow
    if (event.type === 'unfollow') {
      const userId = event.source.userId
      addLog('info', 'User unfollowed', { userId })
      try {
        await firebase_delete(`followers/${userId}`)
        addLog('info', 'Follower removed successfully', { userId })
      } catch (fbErr) {
        addLog('error', 'Firebase delete error', { message: fbErr.message })
      }
    }

    // เมื่อมีคนส่งข้อความ (บันทึก userId เพิ่มเติม)
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId
      addLog('info', 'Message from user', { userId, text: event.message.text })
      try {
        // เก็บ userId ถ้ายังไม่มี
        const exists = await firebase_get(`followers/${userId}`)
        if (!exists) {
          await firebase_set(`followers/${userId}`, {
            userId: userId,
            firstMessageAt: new Date().toISOString(),
            status: 'active'
          })
          addLog('info', 'New follower from message', { userId })
        }
      } catch (fbErr) {
        addLog('error', 'Firebase message save error', { message: fbErr.message })
      }
    }
  } catch (err) {
    addLog('error', 'Handle event error', { message: err.message })
  }
}

// Send ให้ USER เดียว (ถ้าส่ง userId ใน request)
app.post("/send", async (req,res)=>{

 const { text, userId } = req.body
 const targetUserId = userId // ใช้ userId จากอีกส่ง, ถ้าไม่มีจะ undefined

 addLog('info', 'Send message request', { text, userId: targetUserId })

 try{

  await client.pushMessage(targetUserId,{
   type:"text",
   text:text
  })

  addLog('info', 'Message sent successfully', { userId: targetUserId })
  res.json({status:"sent"})

 }catch(err){

 addLog('error', 'LINE send error', { userId: targetUserId, message: err.message })

 res.status(500).send("error")

}

})

// Broadcast - ส่งให้ทุกคน
app.post("/broadcast", async (req, res) => {
  const { text } = req.body

  if (!text) {
    return res.status(400).json({ error: "text is required" })
  }

  addLog('info', 'Broadcast request', { text })

  try {
    const followers = await firebase_get("followers")

    if (!followers || typeof followers !== 'object') {
      addLog('warn', 'Broadcast - no followers')
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
        addLog('error', `Broadcast error to user`, { userId, message: err.message })
        errorCount++
      }
    }

    addLog('info', `Broadcast complete`, { successCount, errorCount, totalFollowers: Object.keys(followers).length })
    res.json({ 
      status: "broadcast sent",
      successCount: successCount,
      errorCount: errorCount,
      totalFollowers: Object.keys(followers).length
    })
  } catch (err) {
    addLog('error', 'Broadcast error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Get followers list
app.get("/followers", async (req, res) => {
  try {
    const followers = await firebase_get("followers")
    
    if (!followers || typeof followers !== 'object') {
      addLog('info', 'Get followers - empty')
      return res.json({ 
        followers: {},
        count: 0
      })
    }
    
    addLog('info', 'Get followers', { count: Object.keys(followers).length })
    res.json({ 
      followers: followers,
      count: Object.keys(followers).length
    })
  } catch (err) {
    addLog('error', 'Get followers error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Test endpoint - เพิ่ม follower สำหรับทดสอบ
app.post("/test-add-follower", async (req, res) => {
  try {
    const testUserId = "Ue78fdf247dea19fe8ef461f8645ef746"
    addLog('info', 'Adding test follower', { userId: testUserId })
    
    const result = await firebase_set(`followers/${testUserId}`, {
      userId: testUserId,
      followedAt: new Date().toISOString(),
      status: 'active'
    })
    
    addLog('info', 'Test follower added successfully', { userId: testUserId })
    res.json({ status: "Test follower added", userId: testUserId, firebaseResponse: result })
  } catch (err) {
    addLog('error', 'Test add follower error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Debug endpoint - ตรวจสอบ Firebase
app.get("/debug", async (req, res) => {
  try {
    addLog('info', 'Debug endpoint called')
    const followers = await firebase_get("followers")
    
    res.json({
      status: "debug",
      firebaseUrl: FIREBASE_DB_URL,
      followersData: followers,
      followersCount: followers && typeof followers === 'object' ? Object.keys(followers).length : 0
    })
  } catch (err) {
    addLog('error', 'Debug error', { message: err.message })
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

// Get logs - แสดง logs ล่าสุด 100 รายการ
app.get("/logs", (req, res) => {
  res.json({
    status: "ok",
    logCount: logs.length,
    logs: logs.slice(-100) // ส่ง 100 logs ล่าสุด
  })
})

// Get all logs from Firebase
app.get("/logs-history", async (req, res) => {
  try {
    addLog('info', 'Fetching logs history from Firebase')
    const allLogs = await firebase_get("logs")
    
    res.json({
      status: "ok",
      logsFromFirebase: allLogs || {}
    })
  } catch (err) {
    addLog('error', 'Get logs history error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Clear logs - ลบ logs ทั้งหมด
app.post("/clear-logs", async (req, res) => {
  try {
    addLog('info', 'Clearing logs')
    logs = []
    await firebase_delete("logs")
    res.json({ status: "Logs cleared" })
  } catch (err) {
    addLog('error', 'Clear logs error', { message: err.message })
    res.status(500).json({ error: err.message })
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
app.get("/info", (req, res) => {
  res.json({
    status: "Server running",
    timestamp: new Date().toISOString(),
    firebaseUrl: FIREBASE_DB_URL,
    logsCount: logs.length,
    endpoints: {
      followers: "/followers",
      logs: "/logs",
      logsHistory: "/logs-history",
      broadcast: "POST /broadcast",
      send: "POST /send"
    }
  })
})

const PORT = process.env.PORT || 3000

app.listen(PORT,()=>{
 addLog('info', 'Server started successfully', { port: PORT, nodeEnv: process.env.NODE_ENV })
})