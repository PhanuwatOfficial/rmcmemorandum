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

// ──────────────────────────────────────────────
// Authentication System (Simple Token-based)
// ──────────────────────────────────────────────
let sessions = {} // Store active sessions in memory

function createToken() {
  return crypto.randomBytes(32).toString('hex')
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }
  
  const token = authHeader.substring(7)
  const userId = sessions[token]
  
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  
  req.userId = userId
  next()
}

// ──────────────────────────────────────────────
// User Authentication Routes
// ──────────────────────────────────────────────

// Register
app.post("/register", async (req, res) => {
  try {
    const { username, name, surname, password } = req.body
    
    if (!username || !name || !surname || !password) {
      return res.status(400).json({ error: "Missing required fields" })
    }
    
    addLog('info', 'Register attempt', { username })
    
    // เช็คว่า username มีอยู่แล้วหรือไม่
    const existingUser = await firebase_get(`users_by_username/${username}`)
    if (existingUser) {
      addLog('warn', 'Username already exists', { username })
      return res.status(400).json({ error: "Username already exists" })
    }
    
    // สร้าง user object
    const userId = `user_${Date.now()}`
    
    const userData = {
      userId,
      username,
      name,
      surname,
      password: password,
      role: 'user',
      createdAt: new Date().toISOString(),
      linkedFollowers: {}
    }
    
    // บันทึก user ลงใน Firebase
    await firebase_set(`users/${userId}`, userData)
    await firebase_set(`users_by_username/${username}`, { userId })
    
    addLog('info', 'User registered successfully', { userId, username })
    res.json({ status: "User registered successfully", userId })
  } catch (err) {
    addLog('error', 'Register error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Login
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body
    
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" })
    }
    
    addLog('info', 'Login attempt', { username })
    
    // หา user ด้วย username
    const userRef = await firebase_get(`users_by_username/${username}`)
    if (!userRef) {
      addLog('warn', 'Login failed - user not found', { username })
      return res.status(401).json({ error: "Invalid credentials" })
    }
    
    const userId = userRef.userId
    const user = await firebase_get(`users/${userId}`)
    
    // เช็คพาสเวิร์ด
    if (user.password !== password) {
      addLog('warn', 'Login failed - invalid password', { username })
      return res.status(401).json({ error: "Invalid credentials" })
    }
    
    // สร้าง token
    const token = createToken()
    sessions[token] = userId
    
    addLog('info', 'Login successful', { userId, username })
    res.json({ 
      status: "Login successful",
      token,
      user: {
        userId,
        username,
        name: user.name,
        surname: user.surname,
        role: user.role || 'user'
      }
    })
  } catch (err) {
    addLog('error', 'Login error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Get current user
app.get("/user/me", verifyToken, async (req, res) => {
  try {
    const user = await firebase_get(`users/${req.userId}`)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }
    
    // ลบ password ออกจากการส่งกลับ
    delete user.password
    res.json(user)
  } catch (err) {
    addLog('error', 'Get user error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Link follower to user
app.post("/user/link-follower", verifyToken, async (req, res) => {
  try {
    const { followerId } = req.body
    
    if (!followerId) {
      return res.status(400).json({ error: "followerId required" })
    }
    
    addLog('info', 'Linking follower to user', { userId: req.userId, followerId })
    
    // เช็คว่า follower มีอยู่หรือไม่
    const follower = await firebase_get(`followers/${followerId}`)
    if (!follower) {
      return res.status(404).json({ error: "Follower not found" })
    }
    
    // บันทึก link
    const user = await firebase_get(`users/${req.userId}`)
    if (!user.linkedFollowers) {
      user.linkedFollowers = {}
    }
    user.linkedFollowers[followerId] = {
      displayName: follower.displayName,
      linkedAt: new Date().toISOString()
    }
    
    await firebase_set(`users/${req.userId}`, user)
    
    addLog('info', 'Follower linked successfully', { userId: req.userId, followerId })
    res.json({ status: "Follower linked successfully" })
  } catch (err) {
    addLog('error', 'Link follower error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Unlink follower from user
app.post("/user/unlink-follower", verifyToken, async (req, res) => {
  try {
    const { followerId } = req.body
    
    if (!followerId) {
      return res.status(400).json({ error: "followerId required" })
    }
    
    addLog('info', 'Unlinking follower from user', { userId: req.userId, followerId })
    
    const user = await firebase_get(`users/${req.userId}`)
    if (user.linkedFollowers && user.linkedFollowers[followerId]) {
      delete user.linkedFollowers[followerId]
      await firebase_set(`users/${req.userId}`, user)
    }
    
    addLog('info', 'Follower unlinked successfully', { userId: req.userId, followerId })
    res.json({ status: "Follower unlinked successfully" })
  } catch (err) {
    addLog('error', 'Unlink follower error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Change password
app.post("/user/change-password", verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required" })
    }
    
    addLog('info', 'Change password attempt', { userId: req.userId })
    
    const user = await firebase_get(`users/${req.userId}`)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }
    
    // Verify current password
    if (user.password !== currentPassword) {
      addLog('warn', 'Change password failed - incorrect current password', { userId: req.userId })
      return res.status(401).json({ error: "Current password is incorrect" })
    }
    
    // Update password
    user.password = newPassword
    await firebase_set(`users/${req.userId}`, user)
    
    addLog('info', 'Password changed successfully', { userId: req.userId })
    res.json({ status: "Password changed successfully" })
  } catch (err) {
    addLog('error', 'Change password error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Get user's linked followers
app.get("/user/followers", verifyToken, async (req, res) => {
  try {
    const user = await firebase_get(`users/${req.userId}`)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }
    
    const linkedFollowers = user.linkedFollowers || {}
    res.json({
      followerCount: Object.keys(linkedFollowers).length,
      followers: linkedFollowers
    })
  } catch (err) {
    addLog('error', 'Get user followers error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Get all users (admin only)
app.get("/admin/users", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }
    
    const allUsersData = await firebase_get('users')
    if (!allUsersData) {
      return res.json({ users: [] })
    }
    
    const users = Object.values(allUsersData).map(user => ({
      userId: user.userId,
      username: user.username,
      name: user.name,
      surname: user.surname,
      password: user.password,
      role: user.role || 'user',
      createdAt: user.createdAt
    }))
    
    res.json({ users })
  } catch (err) {
    addLog('error', 'Get all users error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Admin: Link follower to any user
app.post("/admin/link-follower-to-user", verifyToken, async (req, res) => {
  try {
    const { userId, followerId } = req.body
    
    if (!userId || !followerId) {
      return res.status(400).json({ error: "userId and followerId required" })
    }
    
    // ตรวจสอบว่า current user เป็น admin
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }
    
    addLog('info', 'Admin linking follower to user', { adminId: req.userId, userId, followerId })
    
    // เช็คว่า follower มีอยู่หรือไม่
    const follower = await firebase_get(`followers/${followerId}`)
    if (!follower) {
      return res.status(404).json({ error: "Follower not found" })
    }
    
    // เช็คว่า target user มีอยู่หรือไม่
    const targetUser = await firebase_get(`users/${userId}`)
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" })
    }
    
    // บันทึก link
    if (!targetUser.linkedFollowers) {
      targetUser.linkedFollowers = {}
    }
    targetUser.linkedFollowers[followerId] = {
      displayName: follower.displayName,
      linkedAt: new Date().toISOString()
    }
    
    await firebase_set(`users/${userId}`, targetUser)
    
    addLog('info', 'Follower linked successfully', { adminId: req.userId, userId, followerId })
    res.json({ status: "Follower linked successfully" })
  } catch (err) {
    addLog('error', 'Admin link follower error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Admin: Get all linked followers across all users
app.get("/admin/all-linked-followers", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }
    
    const allUsersData = await firebase_get('users')
    if (!allUsersData) {
      return res.json({ linkedFollowers: [] })
    }
    
    const linkedFollowers = []
    for (let userId in allUsersData) {
      const user = allUsersData[userId]
      if (user.linkedFollowers && Object.keys(user.linkedFollowers).length > 0) {
        for (let followerId in user.linkedFollowers) {
          const link = user.linkedFollowers[followerId]
          linkedFollowers.push({
            userId: user.userId,
            username: user.username,
            name: user.name,
            surname: user.surname,
            followerId: followerId,
            followerName: link.displayName,
            linkedAt: link.linkedAt
          })
        }
      }
    }
    
    res.json({ linkedFollowers })
  } catch (err) {
    addLog('error', 'Get all linked followers error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Admin: Unlink follower from any user
app.post("/admin/unlink-follower-from-user", verifyToken, async (req, res) => {
  try {
    const { userId, followerId } = req.body
    
    if (!userId || !followerId) {
      return res.status(400).json({ error: "userId and followerId required" })
    }
    
    // ตรวจสอบว่า current user เป็น admin
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }
    
    addLog('info', 'Admin unlinking follower from user', { adminId: req.userId, userId, followerId })
    
    const targetUser = await firebase_get(`users/${userId}`)
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" })
    }
    
    if (targetUser.linkedFollowers && targetUser.linkedFollowers[followerId]) {
      delete targetUser.linkedFollowers[followerId]
      await firebase_set(`users/${userId}`, targetUser)
    }
    
    addLog('info', 'Follower unlinked successfully', { adminId: req.userId, userId, followerId })
    res.json({ status: "Follower unlinked successfully" })
  } catch (err) {
    addLog('error', 'Admin unlink follower error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

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
        // ดึง profile จาก LINE
        let profile = null
        try {
          profile = await client.getProfile(userId)
          addLog('info', 'Profile fetched', { userId, displayName: profile.displayName })
        } catch (profileErr) {
          addLog('warn', 'Could not fetch profile', { userId, error: profileErr.message })
          profile = { displayName: 'Unknown', pictureUrl: null, statusMessage: null }
        }
        
        await firebase_set(`followers/${userId}`, {
          userId: userId,
          displayName: profile.displayName || 'Unknown',
          pictureUrl: profile.pictureUrl || null,
          statusMessage: profile.statusMessage || null,
          followedAt: new Date().toISOString(),
          status: 'active'
        })
        addLog('info', 'Follower saved successfully', { userId, displayName: profile.displayName })
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
          // ดึง profile จาก LINE
          let profile = null
          try {
            profile = await client.getProfile(userId)
            addLog('info', 'Profile fetched from message', { userId, displayName: profile.displayName })
          } catch (profileErr) {
            addLog('warn', 'Could not fetch profile from message', { userId, error: profileErr.message })
            profile = { displayName: 'Unknown', pictureUrl: null, statusMessage: null }
          }
          
          await firebase_set(`followers/${userId}`, {
            userId: userId,
            displayName: profile.displayName || 'Unknown',
            pictureUrl: profile.pictureUrl || null,
            statusMessage: profile.statusMessage || null,
            firstMessageAt: new Date().toISOString(),
            status: 'active'
          })
          addLog('info', 'New follower from message', { userId, displayName: profile.displayName })
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

 const { userId, recipientUserId, title, type, content, senderUserId } = req.body
 const targetUserId = userId
 // recipientUserId is the system user ID who manages this follower
 // userId is the LINE follower ID

 addLog('info', 'Send message request', { title, type, userId: targetUserId, recipientUserId: recipientUserId, hasRecipientUserId: !!recipientUserId })
 console.log('🔍 /send endpoint received:', { userId, recipientUserId, senderUserId, title })

 try{

  // Get sender information if senderUserId is provided
  let senderName = 'System'
  if (senderUserId) {
    try {
      const sender = await firebase_get(`users/${senderUserId}`)
      if (sender) {
        senderName = `${sender.name || ''} ${sender.surname || ''}`.trim()
      }
    } catch (err) {
      addLog('warn', 'Could not fetch sender info', { senderUserId, error: err.message })
    }
  }

  const lineMessage = {
    type: "flex",
    altText: `New Memorandum: ${title}`,
    contents: {
      type: "bubble",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "📋 New Memorandum",
            weight: "bold",
            color: "#182034",
            size: "xl"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: title,
            weight: "bold",
            size: "lg",
            wrap: true,
            color: "#182034"
          },
          {
            type: "text",
            text: `From: ${senderName}`,
            size: "sm",
            color: "#c8a96e",
            weight: "bold",
            margin: "md"
          },
          {
            type: "text",
            text: `Type: ${type || 'Announcement'}`,
            size: "sm",
            color: "#1a2740",
            weight: "bold",
            margin: "md"
          },
          {
            type: "separator",
            margin: "md"
          },
          {
            type: "text",
            text: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
            size: "sm",
            color: "#666666",
            wrap: true,
            margin: "md"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            action: {
              type: "uri",
              label: "View Details",
              uri: "https://rmcmemorandum.up.railway.app/"
            },
            style: "primary",
            color: "#1a2740"
          }
        ]
      }
    }
  }

  await client.pushMessage(targetUserId, lineMessage)

  // Store memo in Firebase
  const memoId = `memo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  const memoData = {
    memoId,
    title,
    type,
    content,
    recipientId: targetUserId,
    senderId: senderUserId,
    sentAt: new Date().toISOString()
  }
  
  console.log('💾 Storing memo:', memoData)
  
  // Store under the sender's sent memos
  if (senderUserId) {
    await firebase_set(`sent_memos/${senderUserId}/${memoId}`, memoData)
    addLog('info', 'Memo stored in sent_memos', { senderId: senderUserId, memoId })
    
    // Create notification for recipient
    // If recipientUserId is provided, create notification for the system user who owns the follower
    // Otherwise create for the targetUserId (for backward compatibility)
    const notificationTargetId = recipientUserId || targetUserId
    try {
      const sender = await firebase_get(`users/${senderUserId}`)
      const senderFullName = sender ? `${sender.name} ${sender.surname}`.trim() : 'ผู้ส่ง'
      
      const notification = {
        id: Date.now().toString(),
        title: 'ได้รับ Memo ใหม่',
        message: `"${title}" จาก ${senderFullName}`,
        type: 'info',
        read: false,
        timestamp: new Date().toISOString(),
        memoId: memoId,
        senderId: senderUserId,
        recipientId: notificationTargetId,
        followerId: targetUserId
      }
      
      await firebase_set(`notifications/${notificationTargetId}/${notification.id}`, notification)
      addLog('info', 'Notification created for recipient', { recipientUserId: notificationTargetId, memoId, followerId: targetUserId })
    } catch (err) {
      addLog('warn', 'Failed to create notification for recipient', { recipientUserId: notificationTargetId, error: err.message })
    }
  } else {
    addLog('warn', 'No senderUserId provided - memo not stored in sent_memos', { targetUserId, memoId })
  }

  addLog('info', 'Message sent successfully', { userId: targetUserId, memoId, senderUserId })
  res.json({status:"sent", memoId})

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

// Get sent memos for current user
app.get("/sent-memos", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    console.log('🔍 Fetching sent memos for user:', userId)
    addLog('info', 'Fetching sent memos', { userId })
    
    const sentMemos = await firebase_get(`sent_memos/${userId}`)
    console.log('📦 Firebase response:', sentMemos)
    
    if (!sentMemos || typeof sentMemos !== 'object') {
      addLog('info', 'Get sent memos - empty', { userId })
      console.log('⚠️  No sent memos found for user:', userId)
      return res.json({ memos: [], count: 0 })
    }
    
    // Convert to array and sort by sentAt descending (newest first)
    const memosArray = Object.values(sentMemos)
    memosArray.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
    
    // Enrich each memo with recipient name (user who linked the follower)
    for (let memo of memosArray) {
      try {
        // Find the user who linked this follower
        if (memo.recipientId) {
          const allUsers = await firebase_get('users')
          if (allUsers) {
            for (let uid in allUsers) {
              const user = allUsers[uid]
              if (user.linkedFollowers && user.linkedFollowers[memo.recipientId]) {
                // Found the user who linked this follower
                memo.recipientName = `${user.name} ${user.surname}`
                break
              }
            }
          }
        }
      } catch (e) {
        console.log('ℹ️  Could not find user who linked follower:', memo.recipientId)
      }
    }

    
    
    console.log('✅ Returning', memosArray.length, 'memos for user:', userId)
    addLog('info', 'Sent memos retrieved successfully', { userId, count: memosArray.length })
    res.json({ memos: memosArray, count: memosArray.length })
  } catch (err) {
    console.error('❌ Error fetching sent memos:', err)
    addLog('error', 'Get sent memos error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// ── Notification Endpoints ──────────────────────────────
// Get all notifications for a user
app.get("/notifications", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    addLog('info', 'Fetching notifications', { userId })
    
    const notificationsData = await firebase_get(`notifications/${userId}`)
    
    if (!notificationsData || typeof notificationsData !== 'object') {
      addLog('info', 'Get notifications - empty', { userId })
      return res.json({ notifications: [], count: 0 })
    }
    
    // Convert to array and sort by timestamp descending (newest first)
    const notificationsArray = Object.values(notificationsData)
    notificationsArray.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    
    addLog('info', 'Notifications retrieved', { userId, count: notificationsArray.length })
    res.json({ notifications: notificationsArray, count: notificationsArray.length })
  } catch (err) {
    addLog('error', 'Get notifications error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Create a new notification
app.post("/notifications", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const { title, message, type } = req.body
    
    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message required' })
    }
    
    const notificationId = Date.now().toString()
    const notification = {
      id: notificationId,
      title: title,
      message: message,
      type: type || 'info',
      read: false,
      timestamp: new Date().toISOString()
    }
    
    await firebase_set(`notifications/${userId}/${notificationId}`, notification)
    addLog('info', 'Notification created', { userId, notificationId })
    
    res.json({ status: 'Notification saved', notification })
  } catch (err) {
    addLog('error', 'Create notification error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Mark notification as read
app.put("/notifications/:id", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const notificationId = req.params.id
    
    const notification = await firebase_get(`notifications/${userId}/${notificationId}`)
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' })
    }
    
    await firebase_set(`notifications/${userId}/${notificationId}`, {
      ...notification,
      read: true
    })
    
    addLog('info', 'Notification marked as read', { userId, notificationId })
    res.json({ status: 'Notification updated', notification: { ...notification, read: true } })
  } catch (err) {
    addLog('error', 'Update notification error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Delete a notification
app.delete("/notifications/:id", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const notificationId = req.params.id
    
    await firebase_delete(`notifications/${userId}/${notificationId}`)
    addLog('info', 'Notification deleted', { userId, notificationId })
    
    res.json({ status: 'Notification deleted' })
  } catch (err) {
    addLog('error', 'Delete notification error', { message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Delete all notifications
app.delete("/notifications", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    
    await firebase_delete(`notifications/${userId}`)
    addLog('info', 'All notifications deleted', { userId })
    
    res.json({ status: 'All notifications cleared' })
  } catch (err) {
    addLog('error', 'Clear notifications error', { message: err.message })
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

// Refresh profile for a specific user
app.post("/refresh-profile/:userId", async (req, res) => {
  const userId = req.params.userId
  try {
    addLog('info', 'Attempting to refresh profile', { userId })
    
    // ดึง profile จาก LINE
    const profile = await client.getProfile(userId)
    addLog('info', 'Profile fetched successfully', { userId, displayName: profile.displayName })
    
    // อัปเดต Firebase
    const followerData = await firebase_get(`followers/${userId}`)
    await firebase_set(`followers/${userId}`, {
      ...followerData,
      displayName: profile.displayName,
      pictureUrl: profile.pictureUrl,
      statusMessage: profile.statusMessage
    })
    
    res.json({ 
      status: "Profile refreshed", 
      profile: {
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
        statusMessage: profile.statusMessage
      }
    })
  } catch (err) {
    addLog('error', 'Refresh profile error', { userId, message: err.message })
    res.status(500).json({ error: err.message })
  }
})

// Refresh all profiles
app.post("/refresh-all-profiles", async (req, res) => {
  try {
    addLog('info', 'Starting refresh all profiles')
    
    const followers = await firebase_get("followers")
    if (!followers || typeof followers !== 'object') {
      addLog('info', 'No followers to refresh')
      return res.json({ status: "no followers", refreshed: 0 })
    }
    
    let refreshed = 0
    let failed = 0
    
    for (let userId in followers) {
      try {
        const profile = await client.getProfile(userId)
        const followerData = followers[userId]
        
        await firebase_set(`followers/${userId}`, {
          ...followerData,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl,
          statusMessage: profile.statusMessage
        })
        
        refreshed++
        addLog('info', 'Profile refreshed', { userId, displayName: profile.displayName })
      } catch (err) {
        failed++
        addLog('warn', 'Failed to refresh profile', { userId, error: err.message })
      }
    }
    
    addLog('info', 'Refresh all profiles complete', { refreshed, failed })
    res.json({ 
      status: "Refresh complete",
      refreshed: refreshed,
      failed: failed,
      total: Object.keys(followers).length
    })
  } catch (err) {
    addLog('error', 'Refresh all profiles error', { message: err.message })
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

// Clear logs - ลบ logs ทั้งหมด และ Backup ใน Firebase
app.post("/clear-logs", async (req, res) => {
  try {
    addLog('info', 'Starting logs backup and clear process')
    
    // สร้าง backup object ด้วย timestamp
    const backupData = {
      backupDate: new Date().toISOString(),
      logsCount: logs.length,
      logs: logs
    }
    
    // บันทึก logs ลงใน logs_Backup ใน Firebase
    await firebase_set(`logs_Backup/${Date.now()}`, backupData)
    addLog('info', 'Logs backed up to Firebase', { backupCount: logs.length })
    
    // ลบ logs จาก memory
    logs = []
    
    // ลบ logs จาก Firebase
    await firebase_delete("logs")
    
    addLog('info', 'Logs cleared successfully after backup')
    res.json({ 
      status: "Logs cleared and backed up",
      backupCount: backupData.logsCount,
      backupDate: backupData.backupDate
    })
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