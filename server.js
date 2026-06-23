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

function addLog(level, messageKey, data = null) {
  const timestamp = new Date().toISOString()
  const logEntry = {
    timestamp,
    level,
    message: messageKey,  // Store the translation key, frontend will translate
    data
  }

  // บันทึก log ในหน่วยความจำ
  logs.push(logEntry)

  // เก็บ max 1000 logs
  if (logs.length > MAX_LOGS) {
    logs.shift()
  }

  // บันทึก log ลงใน Firebase
  firebase_set(`logs/${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, logEntry).catch(err => {
    console.error('❌ [LOGS] Firebase write failed:', err.message)
    console.error('   Timestamp:', timestamp)
    console.error('   Level:', level)
    console.error('   Message Key:', messageKey)
  })
}

//  const config = {
//    channelAccessToken: "b2fh2LSS5Tol02wcgAaglG69RToFh2PBEJ0rmt+2+usd1j9QnOdlo9iQav/mgM9WqTGTfbqPFNGlyy2dc3/4VJge9GCvwHhgPsWNzdk+b+n8/m/wfW91odnR57Y6T32Ibj6i6p3DOv8ujtXzybwdtgdB04t89/1O/w1cDnyilFU=",
//    channelSecret: "8b11f8b0519a6b827f6c0c69664cf207"
//  }



//Line Official Account Test
const config = {
  channelAccessToken: "26QcmPpK39AJ60Mg9tnk9sorWmm9DhOv70KjkSradTe3UGenhIlhUrLii4kWukxF0BWOA/3FNhlZUQ25rMiS+cdsz33h/esKxpyXEEJx3i9Xv755YQABvc61s63yenpEmyvMC9ZUwFDTcAz/2ERAYQdB04t89/1O/w1cDnyilFU=",
  channelSecret: "3e94265fab13b7b71fb338a355d4fc9d"
}

const client = new line.Client(config)

// Firebase Realtime Database (ใช้ REST API แทน Admin SDK)
//const FIREBASE_PROJECT_ID = "line-6191d"
// const FIREBASE_PROJECT_ID = "test2-a3a49"
const FIREBASE_PROJECT_ID = "leave-10269"
// const FIREBASE_PROJECT_ID = "keyproject-84461"

// const FIREBASE_DB_URL = "https://import-acd62-default-rtdb.asia-southeast1.firebasedatabase.app"
// const FIREBASE_DB_URL = "https://line-6191d-default-rtdb.asia-southeast1.firebasedatabase.app"
// const FIREBASE_DB_URL = "https://test2-a3a49-default-rtdb.asia-southeast1.firebasedatabase.app"
const FIREBASE_DB_URL = "https://leave-10269-default-rtdb.asia-southeast1.firebasedatabase.app"
// const FIREBASE_DB_URL = "https://keyproject-84461-default-rtdb.asia-southeast1.firebasedatabase.app"



// Firebase Functions เพื่อดึง/บันทึกข้อมูล
async function firebase_set(path, data) {
  try {
    const url = `${FIREBASE_DB_URL}/${path}.json`

    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    })

    const result = await response.json()

    if (!response.ok) {
      throw new Error(`Firebase set failed: ${response.status} ${response.statusText}`)
    }

    return result
  } catch (err) {
    throw err
  }
}

async function firebase_get(path) {
  try {
    const url = `${FIREBASE_DB_URL}/${path}.json`
    const response = await fetch(url)
    return await response.json()
  } catch (err) {
    throw err
  }
}

async function firebase_delete(path) {
  try {
    const url = `${FIREBASE_DB_URL}/${path}.json`
    await fetch(url, { method: "DELETE" })
  } catch (err) {
    throw err
  }
}

// ──────────────────────────────────────────────
// Authentication System (Simple Token-based with Firebase persistence)
// ──────────────────────────────────────────────
// Sessions are now stored in Firebase to persist across redeployments
// No session expiry - tokens persist indefinitely

function createToken() {
  return crypto.randomBytes(32).toString('hex')
}

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = authHeader.substring(7)

  try {
    // Get token from Firebase
    const sessionData = await firebase_get(`sessions/${token}`)

    if (!sessionData || !sessionData.userId) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }

    req.userId = sessionData.userId
    next()
  } catch (err) {
    console.error('Token verification error:', err)
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// ──────────────────────────────────────────────
// User Authentication Routes
// ──────────────────────────────────────────────

// Register
app.post("/register", async (req, res) => {
  try {
    const { username, name, surname, password, department, department2 } = req.body

    if (!username || !name || !surname || !password) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // เช็คว่า username มีอยู่แล้วหรือไม่
    const existingUser = await firebase_get(`users_by_username/${username}`)
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" })
    }

    // สร้าง user object
    const userId = `user_${Date.now()}`

    // Check if this is the first user - if so, make them admin
    const allUsers = await firebase_get('users')
    const isFirstUser = !allUsers || Object.keys(allUsers).length === 0

    const userData = {
      userId,
      username,
      name,
      surname,
      password: password,
      department: department || '',
      department2: department2 || '',
      role: isFirstUser ? 'admin' : 'user',
      status: isFirstUser ? 'active' : 'pending',  // First user is active by default
      createdAt: new Date().toISOString(),
      linkedFollowers: {}
    }

    // บันทึก user ลงใน Firebase
    await firebase_set(`users/${userId}`, userData)
    await firebase_set(`users_by_username/${username}`, { userId })

    // Send notification to all admin users about the new registration
    if (!isFirstUser) {
      try {
        const allUsersList = await firebase_get('users')
        if (allUsersList && typeof allUsersList === 'object') {
          for (const [, user] of Object.entries(allUsersList)) {
            if (user.role === 'admin') {
              const notification = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                title: 'New User Registration',
                message: `New user "${username}" (${name} ${surname}) has registered and is awaiting approval`,
                type: 'user_registration',
                read: false,
                timestamp: new Date().toISOString(),
                userId: userId,
                username: username,
                userFullName: `${name} ${surname}`,
                userDepartment: department || '',
                userSubDepartment: department2 || ''
              }
              await firebase_set(`notifications/${user.userId}/${notification.id}`, notification)
            }
          }
        }
      } catch (err) {
        // Log error but don't fail the registration
        console.error('Error sending admin notification:', err)
      }
    }

    addLog('info', 'New user register', { userId, username })
    res.json({ status: "User registered successfully", userId })
  } catch (err) {
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

    // หา user ด้วย username
    const userRef = await firebase_get(`users_by_username/${username}`)
    if (!userRef) {
      return res.status(401).json({ error: "invalidCredentials" })
    }

    const userId = userRef.userId
    const user = await firebase_get(`users/${userId}`)

    // Check if user is pending approval
    if (user.status === 'pending') {
      return res.status(403).json({ error: "Your account is pending admin approval. Please wait for approval to access the system." })
    }

    // เช็คพาสเวิร์ด
    if (user.password !== password) {
      return res.status(401).json({ error: "invalidCredentials" })
    }

    // สร้าง token และบันทึกลงใน Firebase
    const token = createToken()
    await firebase_set(`sessions/${token}`, {
      userId,
      createdAt: new Date().toISOString()
    })

    addLog('info', 'Login', { userId, username })
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
    res.status(500).json({ error: err.message })
  }
})

// Logout
app.post("/logout", verifyToken, async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    const userId = req.userId

    if (userId && token) {
      const user = await firebase_get(`users/${userId}`)
      // Delete token from Firebase
      await firebase_delete(`sessions/${token}`)
      addLog('info', 'Logout', { userId, username: user?.username })
    }

    res.json({ status: "Logout successful" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get pending user registrations (admin only)
app.get("/pending-users", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const user = await firebase_get(`users/${userId}`)

    // Only admins can view pending users
    if (user.role !== 'admin') {
      return res.status(403).json({ error: "Unauthorized" })
    }

    // Fetch all users and filter for pending status
    const allUsers = await firebase_get('users')
    const pendingUsers = []

    for (const uid in allUsers) {
      const u = allUsers[uid]
      if (u.status === 'pending') {
        pendingUsers.push({
          userId: u.userId,
          username: u.username,
          name: u.name,
          surname: u.surname,
          department: u.department,
          department2: u.department2,
          createdAt: u.createdAt
        })
      }
    }

    res.json({ pendingUsers })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Approve pending user (admin only)
app.put("/approve-user/:userId", verifyToken, async (req, res) => {
  try {
    const adminId = req.userId
    const admin = await firebase_get(`users/${adminId}`)

    // Only admins can approve users
    if (admin.role !== 'admin') {
      return res.status(403).json({ error: "Unauthorized" })
    }

    const targetUserId = req.params.userId
    const targetUser = await firebase_get(`users/${targetUserId}`)

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" })
    }

    if (targetUser.status !== 'pending') {
      return res.status(400).json({ error: "User is not pending approval" })
    }

    // Update status to active
    targetUser.status = 'active'
    targetUser.approvedAt = new Date().toISOString()
    targetUser.approvedBy = adminId

    await firebase_set(`users/${targetUserId}`, targetUser)
    const approverName = admin && admin.username ? admin.username : 'Unknown'

    addLog('info', 'Approved user register', { userId: targetUserId, username: targetUser.username, approvedBy: adminId })
    res.json({ status: "User approved successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Reject and delete pending user (admin only)
app.delete("/reject-user/:userId", verifyToken, async (req, res) => {
  try {
    const adminId = req.userId
    const admin = await firebase_get(`users/${adminId}`)

    // Only admins can reject users
    if (admin.role !== 'admin') {
      return res.status(403).json({ error: "Unauthorized" })
    }

    const targetUserId = req.params.userId
    const targetUser = await firebase_get(`users/${targetUserId}`)

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" })
    }

    if (targetUser.status !== 'pending') {
      return res.status(400).json({ error: "User is not pending approval" })
    }

    // Delete user and username reference
    await firebase_delete(`users/${targetUserId}`)
    await firebase_delete(`users_by_username/${targetUser.username}`)

    addLog('info', 'Rejected user', { userId: targetUserId, username: targetUser.username, rejectedBy: adminId })
    res.json({ status: "User rejected and deleted successfully" })
  } catch (err) {
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

    res.json({ status: "Follower linked successfully" })
  } catch (err) {
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

    const user = await firebase_get(`users/${req.userId}`)
    if (!user || !user.linkedFollowers || !user.linkedFollowers[followerId]) {
      return res.status(404).json({ error: "Linked follower not found" })
    }

    const linkedFollowerInfo = user.linkedFollowers[followerId]
    const senderName = `${user.name || ''} ${user.surname || ''}`.trim()

    // Remove the link
    delete user.linkedFollowers[followerId]
    await firebase_set(`users/${req.userId}`, user)

    // Send memo to the unlinked follower
    const memoTitle = '📝 บันทึกข้อความ - ยกเลิกการเชื่อมโยง'
    const memoContent = `สวัสดี ${linkedFollowerInfo.displayName},\n\n${senderName} ได้ยกเลิกการเชื่อมโยงโปรไฟล์ LINE ของพวกเขาไปแล้ว\n\nหากนี่เป็นการดำเนินการอย่างผิดพลาด โปรดติดต่อ ${senderName} อีกครั้ง\n\nขอบคุณ`

    const memoId = `memo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const memoData = {
      memoId,
      title: memoTitle,
      type: 'System Notification',
      content: memoContent,
      docNumber: '',
      recipientId: followerId,
      recipientName: linkedFollowerInfo.displayName,
      followerId: followerId,
      senderId: req.userId,
      senderUserId: req.userId,
      senderName: senderName,
      senderObject: {
        userId: user.userId,
        name: user.name,
        surname: user.surname,
        username: user.username,
        department: user.department || '',
        department2: user.department2 || ''
      },
      sentAt: new Date().toISOString(),
      status: 'sent',
      approvalPending: false,
      isSystemMessage: true
    }

    // Store the memo
    await firebase_set(`sent_memos/${req.userId}/${memoId}`, memoData)

    // Send LINE notification to the unlinked follower
    const lineMessage = {
      type: "flex",
      altText: memoTitle,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: "📝 บันทึกข้อความ",
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
              text: memoTitle,
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
              text: "Type: System Notification",
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
              text: memoContent,
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
                uri: "https://rmcmemorandum.onrender.com/"
              },
              style: "primary",
              color: "#1a2740"
            }
          ]
        }
      }
    }

    try {
      await client.pushMessage(followerId, lineMessage)
    } catch (lineErr) {
      // Silent error
    }
    res.json({ status: "Follower unlinked successfully", memoId, message: `ได้ส่งการแจ้งเตือนไปยัง ${linkedFollowerInfo.displayName}` })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Unlink user profile with memo and LINE notification
app.post("/user/unlink-profile", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const user = await firebase_get(`users/${userId}`)

    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Get first linked follower ID (or the main linked profile)
    const linkedFollowers = user.linkedFollowers || {}
    const followerIds = Object.keys(linkedFollowers)

    if (followerIds.length === 0) {
      return res.status(400).json({ error: "No linked profile to unlink" })
    }

    const followerId = followerIds[0]  // Get the first/main linked follower
    const linkedFollowerInfo = linkedFollowers[followerId]

    // 1. Remove the link from user's account
    delete user.linkedFollowers[followerId]
    await firebase_set(`users/${userId}`, user)

    // 2. Send memo to the linked follower notifying them of the unlink
    const senderName = `${user.name || ''} ${user.surname || ''}`.trim()
    const memoTitle = '📝 บันทึกข้อความ - ยกเลิกการเชื่อมโยง'
    const memoContent = `สวัสดี ${linkedFollowerInfo.displayName},\n\n${senderName} ได้ยกเลิกการเชื่อมโยงโปรไฟล์ LINE ของพวกเขาไปแล้ว\n\nหากนี่เป็นการดำเนินการอย่างผิดพลาด โปรดติดต่อ ${senderName} อีกครั้ง\n\nขอบคุณ`

    const memoId = `memo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const memoData = {
      memoId,
      title: memoTitle,
      type: 'System Notification',
      content: memoContent,
      docNumber: '',
      recipientId: followerId,
      recipientName: linkedFollowerInfo.displayName,
      followerId: followerId,
      senderId: userId,
      senderUserId: userId,
      senderName: senderName,
      senderObject: {
        userId: user.userId,
        name: user.name,
        surname: user.surname,
        username: user.username,
        department: user.department || '',
        department2: user.department2 || ''
      },
      sentAt: new Date().toISOString(),
      status: 'sent',
      approvalPending: false,
      isSystemMessage: true
    }

    // Store the memo
    await firebase_set(`sent_memos/${userId}/${memoId}`, memoData)

    // 3. Send LINE notification to the linked follower
    const lineMessage = {
      type: "flex",
      altText: memoTitle,
      contents: {
        type: "bubble",
        header: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: "📝 บันทึกข้อความ",
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
              text: memoTitle,
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
              text: "Type: System Notification",
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
              text: memoContent,
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
                uri: "https://rmcmemorandum.onrender.com/"
              },
              style: "primary",
              color: "#1a2740"
            }
          ]
        }
      }
    }

    try {
      await client.pushMessage(followerId, lineMessage)
    } catch (lineErr) {
      // Don't fail the unlink if LINE notification fails
    }

    res.json({
      status: "Profile unlinked successfully",
      followerId,
      memoId,
      message: `ได้ส่งการแจ้งเตือนไปยัง ${linkedFollowerInfo.displayName}`
    })
  } catch (err) {
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

    const user = await firebase_get(`users/${req.userId}`)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Verify current password
    if (user.password !== currentPassword) {
      return res.status(401).json({ error: "Current password is incorrect" })
    }

    // Update password
    user.password = newPassword
    await firebase_set(`users/${req.userId}`, user)

    res.json({ status: "Password changed successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Update user's departments
app.post("/user/update-departments", verifyToken, async (req, res) => {
  try {
    const { department, department2 } = req.body

    const user = await firebase_get(`users/${req.userId}`)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Update departments
    user.department = department || ''
    user.department2 = department2 || ''
    await firebase_set(`users/${req.userId}`, user)

    res.json({ status: "Departments updated successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Update user signature image
app.post("/user/update-signature", verifyToken, async (req, res) => {
  try {
    const { signatureImageUrl } = req.body

    const user = await firebase_get(`users/${req.userId}`)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Update signature
    user.signatureImageUrl = signatureImageUrl
    await firebase_set(`users/${req.userId}`, user)

    res.json({ status: "Signature updated successfully" })
  } catch (err) {
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
    res.status(500).json({ error: err.message })
  }
})

// Get user's linked followers with LINE profile pictures
app.get("/user/linked-followers-with-pictures", verifyToken, async (req, res) => {
  try {
    const user = await firebase_get(`users/${req.userId}`)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Get followers database
    const followersData = await firebase_get('followers')
    const followerProfiles = followersData || {}

    // Get all users to find who has linked followers
    const allUsersData = await firebase_get('users')

    const linkedFollowers = []

    // For current user: get their own linked followers with pictures
    const userLinkedFollowers = user.linkedFollowers || {}
    for (let followerId in userLinkedFollowers) {
      const linkedInfo = userLinkedFollowers[followerId]
      const followerProfile = followerProfiles[followerId]

      linkedFollowers.push({
        userId: user.userId,
        username: user.username,
        name: user.name,
        surname: user.surname,
        followerId: followerId,
        followerName: linkedInfo.displayName || 'Unknown',
        pictureUrl: followerProfile?.pictureUrl || null,
        linkedAt: linkedInfo.linkedAt || new Date().toISOString(),
        department: user.department || '—',
        department2: user.department2 || '—'
      })
    }

    // For other users: find those who have linked followers and add them too
    for (let userId in allUsersData) {
      const otherUser = allUsersData[userId]
      if (userId === req.userId) continue // Skip current user

      const otherUserLinkedFollowers = otherUser.linkedFollowers || {}
      if (Object.keys(otherUserLinkedFollowers).length > 0) {
        // This user has linked followers - add them with their first linked follower's picture
        for (let followerId in otherUserLinkedFollowers) {
          const linkedInfo = otherUserLinkedFollowers[followerId]
          const followerProfile = followerProfiles[followerId]

          linkedFollowers.push({
            userId: otherUser.userId,
            username: otherUser.username,
            name: otherUser.name,
            surname: otherUser.surname,
            followerId: followerId,
            followerName: linkedInfo.displayName || 'Unknown',
            pictureUrl: followerProfile?.pictureUrl || null,
            linkedAt: linkedInfo.linkedAt || new Date().toISOString(),
            department: otherUser.department || '—',
            department2: otherUser.department2 || '—'
          })
        }
      }
    }

    res.json({ linkedFollowers })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get user data by userId (for displaying signatures in memos)
app.get("/api/user/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params
    const user = await firebase_get(`users/${userId}`)

    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Return only necessary user data to avoid exposing sensitive info
    res.json({
      userId: user.userId,
      username: user.username,
      name: user.name,
      surname: user.surname,
      department: user.department,
      signatureImageUrl: user.signatureImageUrl || null
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get specific memo with enriched approver signatures (for print preview)
app.get("/api/memo/:memoId", verifyToken, async (req, res) => {
  try {
    const { memoId } = req.params
    const allUsers = await firebase_get('users')
    let foundMemo = null

    // Search for memo across all users' sent_memos
    if (allUsers && typeof allUsers === 'object') {
      for (let userId in allUsers) {
        const sentMemos = await firebase_get(`sent_memos/${userId}`)
        if (sentMemos && sentMemos[memoId]) {
          foundMemo = sentMemos[memoId]
          break
        }
      }
    }

    if (!foundMemo) {
      return res.status(404).json({ error: "Memo not found" })
    }

    // Enrich memo with full approvers data including signatures
    if (foundMemo.approvers && Array.isArray(foundMemo.approvers)) {
      foundMemo.approvalsInfo = await Promise.all(
        foundMemo.approvers.map(async (approver) => {
          const userData = await firebase_get(`users/${approver.approverId}`)
          return {
            approverId: approver.approverId,
            approverName: approver.approverName,
            approverUsername: approver.approverUsername,
            signatureImageUrl: userData?.signatureImageUrl || null
          }
        })
      )
    }

    // Also enrich sender and approvedBy with signatures
    if (foundMemo.senderUserId) {
      const senderUser = await firebase_get(`users/${foundMemo.senderUserId}`)
      if (senderUser) {
        foundMemo.senderSignatureImageUrl = senderUser.signatureImageUrl || null
      }
    }

    if (foundMemo.approvedByUserId) {
      const approverUser = await firebase_get(`users/${foundMemo.approvedByUserId}`)
      if (approverUser) {
        foundMemo.approverSignatureImageUrl = approverUser.signatureImageUrl || null
      }
    }

    res.json(foundMemo)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get departments for autocomplete (accessible to all authenticated users)
// Get next document number (format: YY-0001)
app.get("/next-doc-number", verifyToken, async (req, res) => {
  try {
    const currentYear = new Date().getFullYear().toString().slice(-2) // Get last 2 digits of year

    // Get all users to scan through their sent_memos
    const allUsersData = await firebase_get('users')

    const allMemos = []

    // Scan through each user's sent memos
    if (allUsersData && typeof allUsersData === 'object') {
      for (let userId in allUsersData) {
        try {
          const sentMemosData = await firebase_get(`sent_memos/${userId}`)
          if (sentMemosData && typeof sentMemosData === 'object') {
            const memos = Object.values(sentMemosData)
            allMemos.push(...memos)
          }
        } catch (err) {
          // User has no memos yet, continue
          continue
        }
      }
    }

    // Filter memos from current year that have a docNumber
    const currentYearMemos = allMemos.filter(memo => {
      if (!memo.docNumber) return false
      const memoYear = memo.docNumber.split('-')[0]
      return memoYear === currentYear
    })

    let nextNumber = 1
    if (currentYearMemos.length > 0) {
      // Extract the number part from memos
      const docNumbers = currentYearMemos.map(memo => {
        const parts = memo.docNumber.split('-')
        return parseInt(parts[1]) || 0
      })
      const maxNumber = Math.max(...docNumbers)
      nextNumber = maxNumber + 1
    }

    const docNumber = `${currentYear}-${String(nextNumber).padStart(4, '0')}`

    res.json({ docNumber })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Get Next R&D Project Number (P26-0001 format) ──────────────────────
app.get("/next-rdproject-number", verifyToken, async (req, res) => {
  try {
    const currentYear = new Date().getFullYear().toString().slice(-2) // Get last 2 digits of year

    // Get all users to scan through their sent_memos for R&D projects
    const allUsersData = await firebase_get('users')

    const allRDProjects = []

    // Scan through each user's sent memos
    if (allUsersData && typeof allUsersData === 'object') {
      for (let userId in allUsersData) {
        try {
          const sentMemosData = await firebase_get(`sent_memos/${userId}`)
          if (sentMemosData && typeof sentMemosData === 'object') {
            const memos = Object.values(sentMemosData)
            // Filter only R&D Project memos
            const rdProjects = memos.filter(memo => memo.isRDProject)
            allRDProjects.push(...rdProjects)
          }
        } catch (err) {
          // User has no memos yet, continue
          continue
        }
      }
    }

    // Filter R&D projects from current year that have a docNumber (project number)
    const currentYearProjects = allRDProjects.filter(project => {
      if (!project.docNumber) return false
      const projectYear = project.docNumber.replace(/[^0-9]/g, '').substring(0, 2)
      return projectYear === currentYear
    })

    let nextNumber = 1
    if (currentYearProjects.length > 0) {
      // Extract the number part from project numbers (P26-0001 format)
      const projectNumbers = currentYearProjects.map(project => {
        const match = project.docNumber.match(/(\d+)$/)
        return match ? parseInt(match[1]) : 0
      })
      const maxNumber = Math.max(...projectNumbers)
      nextNumber = maxNumber + 1
    }

    const projectNumber = `P${currentYear}-${String(nextNumber).padStart(4, '0')}`

    res.json({ projectNumber })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── RAW MATERIAL REQUEST NUMBER ENDPOINT ──
app.get("/next-rawmat-number", verifyToken, async (req, res) => {
  try {
    const currentYear = new Date().getFullYear().toString().slice(-2) // Get last 2 digits of year

    // Get all users to scan through their received_memos for Raw Material Requests
    const allUsersData = await firebase_get('users')

    const allRawMatRequests = []

    // Scan through each user's received memos
    if (allUsersData && typeof allUsersData === 'object') {
      for (let userId in allUsersData) {
        try {
          const receivedMemosData = await firebase_get(`received_memos/${userId}`)
          if (receivedMemosData && typeof receivedMemosData === 'object') {
            const memos = Object.values(receivedMemosData)
            // Filter only Raw Material Request memos
            const rawMatRequests = memos.filter(memo => memo.isRawMaterialRequest)
            allRawMatRequests.push(...rawMatRequests)
          }
        } catch (err) {
          // User has no memos yet, continue
          continue
        }
      }
    }

    // Filter requests from current year that have a documentNo (document number)
    const currentYearRequests = allRawMatRequests.filter(request => {
      if (!request.documentNo) return false
      const requestYear = request.documentNo.replace(/[^0-9]/g, '').substring(0, 2)
      return requestYear === currentYear
    })

    let nextNumber = 1
    if (currentYearRequests.length > 0) {
      // Extract the number part from document numbers (R26-0001 format)
      const docNumbers = currentYearRequests.map(request => {
        const match = request.documentNo.match(/(\d+)$/)
        return match ? parseInt(match[1]) : 0
      })
      const maxNumber = Math.max(...docNumbers)
      nextNumber = maxNumber + 1
    }

    const documentNumber = `R${currentYear}-${String(nextNumber).padStart(4, '0')}`

    res.json({ number: documentNumber })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// Check if current user is a memo approver
app.get("/user/is-approver", verifyToken, async (req, res) => {
  try {
    const userId = req.userId

    // Get approver assignments for this user
    const approversData = await firebase_get('memoApprovers')
    let isApprover = false
    let approvalCount = 0

    if (approversData && typeof approversData === 'object') {
      for (const approval of Object.values(approversData)) {
        if (approval.approverId === userId) {
          isApprover = true
          approvalCount++
        }
      }
    }

    res.json({ isApprover, approvalCount })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Check if current user is an R&D Project approver
app.get("/user/is-rdproject-approver", verifyToken, async (req, res) => {
  try {
    const userId = req.userId

    // Get R&D Project roles
    const rolesData = await firebase_get('rd_project_roles')
    let isRDProjectApprover = false

    if (rolesData && rolesData.approverUserId === userId) {
      isRDProjectApprover = true
    }

    res.json({ isRDProjectApprover })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Check if current user is a Raw Material approver (first or second stage)
app.get("/user/is-rawmat-approver", verifyToken, async (req, res) => {
  try {
    const userId = req.userId

    // Get Raw Material approval roles
    const rolesData = await firebase_get('rd_project_roles')
    let isRawMatApprover = false

    if (rolesData) {
      if (rolesData.rawMatFirstApproverId === userId || rolesData.rawMatApproverId === userId) {
        isRawMatApprover = true
      }
    }

    res.json({ isRawMatApprover })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get user stats for dashboard (sent, pending, received, approved memos)
app.get("/memos/user-stats", verifyToken, async (req, res) => {
  try {
    const userId = req.userId

    // ========== SENT MEMOS ==========
    // Path: sent_memos/{userId}/{memoId}
    let sentCount = 0
    let sentMemos = null

    sentMemos = await firebase_get(`sent_memos/${userId}`)
    sentCount = sentMemos && typeof sentMemos === 'object' ? Object.keys(sentMemos).length : 0

    // ========== RECEIVED MEMOS ==========
    // Path: received_memos/{userId}/{memoId}
    let receivedCount = 0

    const receivedMemos = await firebase_get(`received_memos/${userId}`)
    receivedCount = receivedMemos && typeof receivedMemos === 'object' ? Object.keys(receivedMemos).length : 0

    // ========== PENDING APPROVALS ==========
    // Count pending memos this user sent (status = pending_approval)
    let pendingApprovalCount = 0

    if (sentMemos && typeof sentMemos === 'object') {
      for (let memoId in sentMemos) {
        const memo = sentMemos[memoId]
        if (memo.status === 'pending_approval') {
          pendingApprovalCount++
        }
      }
    }

    // ========== APPROVED MEMOS ==========
    let approvedCount = 0

    if (sentMemos && typeof sentMemos === 'object') {
      for (let memoId in sentMemos) {
        const memo = sentMemos[memoId]
        if (memo.status === 'approved') {
          approvedCount++
        }
      }
    }

    const responseData = {
      sentCount,
      receivedCount,
      pendingApprovalCount,
      approvedCount
    }

    res.json(responseData)
  } catch (err) {
    console.error('❌ [STATS] Error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get("/departments", async (req, res) => {
  try {
    const departments = await firebase_get('departments')
    const departments2 = await firebase_get('departments2')

    res.json({
      departments: (departments && typeof departments === 'object') ? Object.values(departments) : [],
      departments2: (departments2 && typeof departments2 === 'object') ? Object.values(departments2) : []
    })
  } catch (err) {
    res.json({ departments: [], departments2: [] })
  }
})

// Get all users (admin and regular users)
app.get("/admin/users", verifyToken, async (req, res) => {
  try {
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
      department: user.department || '',
      department2: user.department2 || '',
      createdAt: user.createdAt
    }))

    res.json({ users })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a system user (admin only)
app.delete("/admin/users/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params

    // Verify current user is admin
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    // Verify user exists
    const userToDelete = await firebase_get(`users/${userId}`)
    if (!userToDelete) {
      return res.status(404).json({ error: "User not found" })
    }

    // Don't allow deleting the only admin
    const allUsers = await firebase_get('users')
    const adminCount = Object.values(allUsers || {}).filter(u => u.role === 'admin').length
    if (userToDelete.role === 'admin' && adminCount <= 1) {
      return res.status(400).json({ error: "Cannot delete the last admin user" })
    }

    // Delete user from users
    await firebase_delete(`users/${userId}`)

    // Delete user from users_by_username
    const username = userToDelete.username
    if (username) {
      await firebase_delete(`users_by_username/${username}`)
    }

    // Log the deletion
    addLog('info', 'User deleted', {
      username: userToDelete.username,
      deletedBy: currentUser.username
    })

    res.json({ status: "User deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Change user role (admin only)
app.put("/admin/users/:userId/role", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params
    const { role } = req.body

    // Verify current user is admin
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    // Validate role
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: "Invalid role" })
    }

    // Verify user exists
    const userToUpdate = await firebase_get(`users/${userId}`)
    if (!userToUpdate) {
      return res.status(404).json({ error: "User not found" })
    }

    // Can't demote the only admin
    if (userToUpdate.role === 'admin' && role === 'user') {
      const allUsers = await firebase_get('users')
      const adminCount = Object.values(allUsers || {}).filter(u => u.role === 'admin').length
      if (adminCount <= 1) {
        return res.status(400).json({ error: "Cannot demote the last admin user" })
      }
    }

    const oldRole = userToUpdate.role
    userToUpdate.role = role
    await firebase_set(`users/${userId}`, userToUpdate)

    // Log the role change
    addLog('info', 'User role changed', {
      userId: userId,
      username: userToUpdate.username,
      oldRole: oldRole,
      newRole: role,
      changedBy: currentUser.username
    })

    res.json({ status: "User role updated successfully", oldRole, newRole: role })
  } catch (err) {
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

    res.json({ status: "Follower linked successfully" })
  } catch (err) {
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

    const targetUser = await firebase_get(`users/${userId}`)
    if (!targetUser) {
      return res.status(404).json({ error: "User not found" })
    }

    if (targetUser.linkedFollowers && targetUser.linkedFollowers[followerId]) {
      delete targetUser.linkedFollowers[followerId]
      await firebase_set(`users/${userId}`, targetUser)
    }

    res.json({ status: "Follower unlinked successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin: Add department (ฝ่าย)
app.post("/admin/departments/add", verifyToken, async (req, res) => {
  try {
    const { name, code } = req.body

    if (!name) {
      return res.status(400).json({ error: "Department name required" })
    }

    // Check if user is admin
    const currentUser = await firebase_get(`users/${req.userId}`)

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" })
    }

    if (currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const deptId = `dept_${Date.now()}`
    const departmentData = {
      id: deptId,
      name,
      code: code || '',
      createdAt: new Date().toISOString(),
      createdBy: req.userId
    }

    await firebase_set(`departments/${deptId}`, departmentData)

    res.json({ status: "Department added successfully", department: departmentData })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin: Add sub-department (แผนก)
app.post("/admin/departments2/add", verifyToken, async (req, res) => {
  try {
    const { name, code } = req.body

    if (!name) {
      return res.status(400).json({ error: "Sub-department name required" })
    }

    // Check if user is admin
    const currentUser = await firebase_get(`users/${req.userId}`)

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" })
    }

    if (currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const deptId = `dept2_${Date.now()}`
    const departmentData = {
      id: deptId,
      name,
      code: code || '',
      createdAt: new Date().toISOString(),
      createdBy: req.userId
    }

    await firebase_set(`departments2/${deptId}`, departmentData)

    res.json({ status: "Sub-department added successfully", department: departmentData })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Admin: Delete department
app.delete("/admin/departments/:deptId", verifyToken, async (req, res) => {
  try {
    const deptId = req.params.deptId

    // Check if user is admin
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const isSubDept = deptId.startsWith('dept2_')
    const path = isSubDept ? `departments2/${deptId}` : `departments/${deptId}`

    await firebase_delete(path)
    res.json({ status: "Department deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get all department-subdepartment links
// Get department-subdepartment links (public endpoint for registration form)
app.get("/department-links-public", async (req, res) => {
  try {
    const links = await firebase_get('departmentLinks')
    const departments = await firebase_get('departments')
    const departments2 = await firebase_get('departments2')

    // Build the response with department and subdepartment names
    let formattedLinks = []
    if (links && typeof links === 'object') {
      for (const [linkId, link] of Object.entries(links)) {
        const dept = departments && departments[link.departmentId]
        const subDept = departments2 && departments2[link.subDepartmentId]

        if (dept && subDept) {
          formattedLinks.push({
            id: linkId,
            departmentId: link.departmentId,
            departmentName: dept.name,
            subDepartmentId: link.subDepartmentId,
            subDepartmentName: subDept.name,
            createdAt: link.createdAt
          })
        }
      }
    }

    res.json({ links: formattedLinks })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get("/admin/department-links", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const links = await firebase_get('departmentLinks')
    const departments = await firebase_get('departments')
    const departments2 = await firebase_get('departments2')

    // Build the response with department and subdepartment names
    let formattedLinks = []
    if (links && typeof links === 'object') {
      for (const [linkId, link] of Object.entries(links)) {
        const dept = departments && departments[link.departmentId]
        const subDept = departments2 && departments2[link.subDepartmentId]

        if (dept && subDept) {
          formattedLinks.push({
            id: linkId,
            departmentId: link.departmentId,
            departmentName: dept.name,
            subDepartmentId: link.subDepartmentId,
            subDepartmentName: subDept.name,
            createdAt: link.createdAt
          })
        }
      }
    }

    res.json({ links: formattedLinks })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create a new department-subdepartment link
app.post("/admin/department-links/add", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const { departmentId, subDepartmentId } = req.body

    if (!departmentId || !subDepartmentId) {
      return res.status(400).json({ error: "Department ID and Sub-Department ID are required" })
    }

    // Check if both departments exist
    const dept = await firebase_get(`departments/${departmentId}`)
    const subDept = await firebase_get(`departments2/${subDepartmentId}`)

    if (!dept) {
      return res.status(404).json({ error: "Department not found" })
    }
    if (!subDept) {
      return res.status(404).json({ error: "Sub-Department not found" })
    }

    // Check if link already exists
    const existingLinks = await firebase_get('departmentLinks')
    if (existingLinks && typeof existingLinks === 'object') {
      for (const link of Object.values(existingLinks)) {
        if (link.departmentId === departmentId && link.subDepartmentId === subDepartmentId) {
          return res.status(400).json({ error: "This link already exists" })
        }
      }
    }

    // Create new link
    const linkId = `link_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const newLink = {
      departmentId,
      subDepartmentId,
      createdAt: new Date().toISOString()
    }

    await firebase_set(`departmentLinks/${linkId}`, newLink)

    res.json({ status: "Link created successfully", linkId, link: newLink })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a department-subdepartment link
app.delete("/admin/department-links/:linkId", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const linkId = req.params.linkId

    await firebase_delete(`departmentLinks/${linkId}`)

    res.json({ status: "Link deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ──────────────────────────────────────────────
// Memo Approval System
// ──────────────────────────────────────────────

// Add memo approver (admin only)
// Can approve for entire department or specific sub-department
app.post("/admin/memo-approvers/add", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const { approverId, departmentId, subDepartmentId } = req.body

    if (!approverId || !departmentId) {
      return res.status(400).json({ error: "approverId and departmentId are required" })
    }

    // Verify approver exists
    const approver = await firebase_get(`users/${approverId}`)
    if (!approver) {
      return res.status(404).json({ error: "Approver user not found" })
    }

    // Create approver assignment
    const approverId_db = `approver_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const approverData = {
      approverId,
      approverName: `${approver.name} ${approver.surname}`,
      approverUsername: approver.username,
      departmentId,
      subDepartmentId: subDepartmentId || null,  // null means entire department
      createdAt: new Date().toISOString(),
      createdBy: req.userId
    }

    await firebase_set(`memoApprovers/${approverId_db}`, approverData)

    res.json({ status: "Approver assigned successfully", approverId: approverId_db })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get all memo approvers (admin only)
app.get("/admin/memo-approvers", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const approvers = await firebase_get('memoApprovers')
    const departments = await firebase_get('departments')
    const departments2 = await firebase_get('departments2')

    let formattedApprovers = []
    if (approvers && typeof approvers === 'object') {
      for (const [id, approver] of Object.entries(approvers)) {
        const dept = departments && departments[approver.departmentId]
        const subDept = approver.subDepartmentId && departments2 && departments2[approver.subDepartmentId]

        formattedApprovers.push({
          id,
          approverId: approver.approverId,
          approverName: approver.approverName,
          approverUsername: approver.approverUsername,
          departmentId: approver.departmentId,
          departmentName: dept?.name || 'Unknown',
          subDepartmentId: approver.subDepartmentId,
          subDepartmentName: subDept?.name || (approver.subDepartmentId ? 'Unknown' : 'All'),
          createdAt: approver.createdAt
        })
      }
    }

    res.json({ approvers: formattedApprovers })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get memo approvers (authenticated users - for checking if current user is an approver)
app.get("/memo-approvers", verifyToken, async (req, res) => {
  try {
    const approvers = await firebase_get('memoApprovers')

    if (!approvers) {
      return res.json({ approvers: [] })
    }

    // Return all approvers data
    const approversList = []
    if (typeof approvers === 'object') {
      for (const [id, approver] of Object.entries(approvers)) {
        approversList.push({
          id,
          approverId: approver.approverId,
          approverName: approver.approverName,
          departmentId: approver.departmentId,
          subDepartmentId: approver.subDepartmentId
        })
      }
    }

    res.json({ approvers: approversList })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete memo approver
app.delete("/admin/memo-approvers/:approverId", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const approverId = req.params.approverId
    await firebase_delete(`memoApprovers/${approverId}`)

    res.json({ status: "Approver removed successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Helper function to resolve DocNumber conflicts
// If the provided docNumber already exists in sent_memos, generate the next available one
async function resolveDocNumberConflict(docNumber, senderUserId) {
  if (!docNumber) return docNumber

  try {
    // Get all sent memos for this user to check for conflicts
    const sentMemosData = await firebase_get(`sent_memos/${senderUserId}`)

    if (!sentMemosData || typeof sentMemosData !== 'object') {
      // No conflict - this docNumber is available
      return docNumber
    }

    // Check if this exact docNumber exists
    let currentDocNumber = docNumber
    let docNumberExists = false

    for (const memoId in sentMemosData) {
      const memo = sentMemosData[memoId]
      if (memo.docNumber === currentDocNumber) {
        docNumberExists = true
        break
      }
    }

    if (!docNumberExists) {
      return currentDocNumber
    }

    // Conflict exists - find the next available number
    const parts = docNumber.split('-')
    const year = parts[0]
    let nextNumber = parseInt(parts[1]) || 0

    // Keep incrementing until we find an available number
    while (true) {
      nextNumber++
      currentDocNumber = `${year}-${String(nextNumber).padStart(4, '0')}`

      let stillExists = false
      for (const memoId in sentMemosData) {
        const memo = sentMemosData[memoId]
        if (memo.docNumber === currentDocNumber) {
          stillExists = true
          break
        }
      }

      if (!stillExists) {
        return currentDocNumber
      }

      // Safety check to prevent infinite loops
      if (nextNumber > 9999) {
        console.error('❌ DocNumber overflow - could not find available number')
        return docNumber
      }
    }
  } catch (err) {
    console.error('Error resolving DocNumber conflict:', err)
    return docNumber
  }
}

// Send memo (now with approval workflow)
app.post("/send", async (req, res) => {
  // Support both old single-recipient and new multi-recipient formats
  let recipientsList = []

  if (req.body.recipients && Array.isArray(req.body.recipients)) {
    // New format: multiple recipients
    recipientsList = req.body.recipients
  } else if (req.body.userId || req.body.recipientUserId) {
    // Old format: single recipient (backward compatibility)
    recipientsList = [{
      userId: req.body.userId,
      recipientUserId: req.body.recipientUserId
    }]
  }

  if (recipientsList.length === 0) {
    return res.status(400).json({ error: 'No recipients specified' })
  }

  const { title, type, content, senderUserId, docNumber, imageUrl, imageUrls } = req.body

  // Support both old format (imageUrl) and new format (imageUrls)
  const finalImageUrls = imageUrls || (imageUrl ? [imageUrl] : []);

  try {
    // Resolve any DocNumber conflicts before proceeding
    let resolvedDocNumber = docNumber
    if (docNumber && senderUserId) {
      resolvedDocNumber = await resolveDocNumberConflict(docNumber, senderUserId)
    }
    // Get sender information if senderUserId is provided
    let senderName = 'System'
    if (senderUserId) {
      try {
        const sender = await firebase_get(`users/${senderUserId}`)
        if (sender) {
          senderName = `${sender.name || ''} ${sender.surname || ''}`.trim()
        }
      } catch (err) {
        // Silent error
      }
    }

    // Check if memo requires approval based on sender's department
    const sender = senderUserId ? await firebase_get(`users/${senderUserId}`) : null

    // Build recipient details for all recipients
    let recipientNames = []
    let recipientIds = []
    let recipientObjects = []
    let followerIds = []

    for (let r of recipientsList) {
      const followerId = r.userId
      let recipientId = r.recipientUserId || r.userId
      let recipientName = recipientId

      let recipientDepartment = ''
      let recipientDepartment2 = ''
      try {
        const recipient = await firebase_get(`users/${recipientId}`)
        if (recipient) {
          recipientName = `${recipient.name || ''} ${recipient.surname || ''}`.trim() || recipientName
          recipientDepartment = recipient.department || ''
          recipientDepartment2 = recipient.department2 || ''
        }
      } catch (err) {
        // Silent error
      }

      recipientNames.push(recipientName)
      recipientIds.push(recipientId)
      followerIds.push(followerId)
      recipientObjects.push({
        followerId: followerId,
        systemUserId: recipientId,
        name: recipientName,
        department: recipientDepartment,
        department2: recipientDepartment2
      })
    }

    const recipientName = recipientNames.join(', ')
    const actualRecipientUserId = recipientIds[0]  // Primary recipient for logging

    // Create memo object
    const memoId = `memo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const memoData = {
      memoId,
      title,
      type,
      content,
      docNumber: resolvedDocNumber || '',
      imageUrls: finalImageUrls && finalImageUrls.length > 0 ? finalImageUrls : null,
      // Multi-recipient support
      recipientIds: recipientIds,  // All system user IDs
      recipientNames: recipientNames,  // All recipient names
      recipientObjects: recipientObjects,  // Full recipient details
      // Backward compatibility - keep primary recipient fields
      recipientId: actualRecipientUserId,
      recipientName: recipientName,
      followerId: followerIds[0],
      senderId: senderUserId,
      senderUserId: senderUserId,  // Also include senderUserId for frontend compatibility
      senderName: senderName,
      senderObject: sender ? {
        userId: sender.userId,
        name: sender.name,
        surname: sender.surname,
        username: sender.username,
        department: sender.department,
        department2: sender.department2
      } : null,
      sentAt: new Date().toISOString(),
      status: 'pending',  // Start as pending
      approvalPending: true,
      approvalChain: []  // Track approval history
    }

    // Initialize approvers array
    let memoApprovers = []

    // Look for approvers for this sender's department
    if (sender && sender.department) {
      // First, convert department name to departmentId by looking in departments
      const allDepartments = await firebase_get('departments')
      let senderDepartmentId = sender.department  // Default to stored value

      // Try to find matching department by name
      if (allDepartments && typeof allDepartments === 'object') {
        for (const [deptId, dept] of Object.entries(allDepartments)) {
          if (dept.name === sender.department) {
            senderDepartmentId = deptId
            break
          }
        }
      }

      // Convert department2 name to ID
      const allDepartments2 = await firebase_get('departments2')
      let senderSubDepartmentId = sender.department2

      // Try to find matching sub-department by name
      if (allDepartments2 && typeof allDepartments2 === 'object') {
        for (const [deptId, dept] of Object.entries(allDepartments2)) {
          if (dept.name === sender.department2) {
            senderSubDepartmentId = deptId
            break
          }
        }
      }

      const approvers = await firebase_get('memoApprovers')

      if (approvers && typeof approvers === 'object') {
        for (const [approverKey, approver] of Object.entries(approvers)) {
          // Check if approver can approve for this department
          if (approver.departmentId === senderDepartmentId) {
            // Either approves entire department or this specific sub-department
            // If approver has no subDepartmentId, they can approve any subdepartment in that department
            const subDeptMatch = !approver.subDepartmentId ? true : (approver.subDepartmentId === senderSubDepartmentId)

            if (subDeptMatch) {
              memoApprovers.push({
                approverId: approver.approverId,
                approverName: approver.approverName,
                approverUsername: approver.approverUsername
              })
            }
          }
        }
      }
    }

    // Check if sender is an approver - if so, bypass approval requirement
    let senderIsApprover = false
    for (const approver of memoApprovers) {
      if (approver.approverId === senderUserId) {
        senderIsApprover = true
        break
      }
    }

    // If approvers found AND sender is NOT an approver, require approval before sending
    if (memoApprovers.length > 0 && !senderIsApprover) {
      memoData.requiresApproval = true
      memoData.approvers = memoApprovers
      memoData.status = 'pending_approval'

      // Store pending memo (NOT SENT YET)
      await firebase_set(`sent_memos/${senderUserId}/${memoId}`, memoData)

      // Create notification for sender to show memo is pending approval
      const senderNotification = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: 'Memo Awaiting Approval',
        message: `"${title}" กำลังรอการอนุมัติ`,
        type: 'pending_approval',
        read: false,
        timestamp: new Date().toISOString(),
        memoId: memoId,
        memoType: 'sent',
        memo: memoData,
        senderId: senderUserId,
        recipientId: actualRecipientUserId
      }

      try {
        await firebase_set(`notifications/${senderUserId}/${senderNotification.id}`, senderNotification)
      } catch (err) {
        // Silent error
      }

      // Create notifications for approvers and send LINE messages
      for (const approver of memoApprovers) {
        const notification = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          title: 'Memo Requires Approval',
          message: `"${title}" from ${senderName} requires your approval`,
          type: 'pending_approval',
          read: false,
          timestamp: new Date().toISOString(),
          memoId: memoId,
          memo: memoData,
          senderId: senderUserId,
          recipientId: actualRecipientUserId
        }

        try {
          await firebase_set(`notifications/${approver.approverId}/${notification.id}`, notification)
        } catch (err) {
          // Silent error
        }

        // Send LINE message to approver
        try {
          const approverUser = await firebase_get(`users/${approver.approverId}`)

          if (approverUser) {
            const approverFollowerIds = approverUser.linkedFollowers ? Object.keys(approverUser.linkedFollowers) : []

            // Create LINE message for approver (with approval request)
            const approverLineMessage = {
              type: "flex",
              altText: `Memorandum Requires Approval: ${title}`,
              contents: {
                type: "bubble",
                header: {
                  type: "box",
                  layout: "vertical",
                  contents: [
                    {
                      type: "text",
                      text: "Memo รอการอนุมัติ",
                      weight: "bold",
                      color: "#1e2c4e",
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
                      color: "#1e2c4e"
                    },
                    {
                      type: "text",
                      text: `From: ${senderName}`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    },
                    {
                      type: "text",
                      text: `Type: ${type || 'Announcement'}`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    },
                    ...(resolvedDocNumber ? [{
                      type: "text",
                      text: `Doc No.: ${resolvedDocNumber}`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    }] : []),
                    {
                      type: "text",
                      text: `Status: ⏳ Pending Approval`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    },
                    {
                      type: "text",
                      text: `Recipient: ${recipientName}`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    },
                    {
                      type: "separator",
                      margin: "md"
                    },
                    {
                      type: "text",
                      text: content.substring(0, 150) + (content.length > 150 ? '...' : ''),
                      size: "sm",
                      color: "#1e2c4e",
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
                        label: "Review & Approve/Reject",
                        uri: "https://rmcmemorandum.onrender.com/"
                      },
                      style: "primary",
                      color: "#1e2c4e"
                    }
                  ]
                }
              }
            }

            if (approverFollowerIds.length > 0) {
              // Send to all linked followers of the approver
              for (const approverFollowerId of approverFollowerIds) {
                try {
                  await client.pushMessage(approverFollowerId, approverLineMessage)
                } catch (lineErr) {
                  // Silent error
                }
              }
            }
          }
        } catch (err) {
          // Silent error
        }
      }

      return res.json({ status: "Memo created - pending approval", memoId, approverCount: memoApprovers.length })
    }

    // No approvers found - send directly (without approval)
    memoData.status = 'sent'
    memoData.approvalPending = false
    memoData.sentTime = new Date().toISOString()

    // Send to all recipients
    for (let i = 0; i < recipientIds.length; i++) {
      const recipientId = recipientIds[i]
      const recipientObj = recipientObjects[i]

      // Get recipient's linked followers from database
      const recipientUser = await firebase_get(`users/${recipientId}`)
      const linkedFollowers = recipientUser && recipientUser.linkedFollowers
        ? Object.keys(recipientUser.linkedFollowers)
        : []

      // Send LINE to all linked followers of this recipient
      for (const followerId of linkedFollowers) {
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
                  text: "New Memorandum",
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
                ...(resolvedDocNumber ? [{
                  type: "text",
                  text: `Doc No.: ${resolvedDocNumber}`,
                  size: "sm",
                  color: "#1a2740",
                  weight: "bold",
                  margin: "md"
                }] : []),
                {
                  type: "text",
                  text: `Status: ⏳ Pending Approval`,
                  size: "sm",
                  color: "#1e2c4e",
                  weight: "bold",
                  margin: "md"
                },
                {
                  type: "text",
                  text: `Recipient: ${recipientName}`,
                  size: "sm",
                  color: "#1e2c4e",
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
                    uri: "https://rmcmemorandum.onrender.com/"
                  },
                  style: "primary",
                  color: "#1a2740"
                }
              ]
            }
          }
        }

        try {
          await client.pushMessage(followerId, lineMessage)
        } catch (lineErr) {
          // Silent error - one follower failure doesn't stop sending to others
        }
      }
    }

    await firebase_set(`sent_memos/${senderUserId}/${memoId}`, memoData)

    // Save to received_memos for all recipients
    for (let recipientId of recipientIds) {
      const recipientCheck = await firebase_get(`users/${recipientId}`)
      if (recipientCheck) {
        const receivedMemo = {
          ...memoData,
          status: 'sent',
          approvalPending: false
        }
        await firebase_set(`received_memos/${recipientId}/${memoId}`, receivedMemo)
      }
    }

    // Create notifications for all recipients
    for (let i = 0; i < recipientIds.length; i++) {
      const recipientId = recipientIds[i]
      const notification = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: 'ได้รับ Memo ใหม่',
        message: `"${title}" ส่งถึง ${recipientNames[i]} จาก ${senderName}`,
        type: 'info',
        read: false,
        timestamp: new Date().toISOString(),
        memoId: memoId,
        memoType: 'received',
        senderId: senderUserId,
        recipientId: recipientId,
        recipientIds: recipientIds
      }
      await firebase_set(`notifications/${recipientId}/${notification.id}`, notification)
    }

    // Create notification for sender (memo sent successfully)
    const senderNotification = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      title: 'ส่ง Memo สำเร็จ',
      message: `ส่ง "${title}" ไปยัง ${recipientName}`,
      type: 'success',
      read: false,
      timestamp: new Date().toISOString(),
      memoId: memoId,
      memoType: 'sent',
      senderId: senderUserId,
      recipientIds: recipientIds
    }
    try {
      await firebase_set(`notifications/${senderUserId}/${senderNotification.id}`, senderNotification)
    } catch (err) {
      // Silent error
    }

    addLog('info', 'Send memo', { title, type, recipientUserId: actualRecipientUserId, senderName })
    res.json({ status: "sent", memoId })

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get pending approvals for current user (approver only, or admin can see all)
app.get("/memos/pending-approval", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const currentUser = await firebase_get(`users/${userId}`)

    if (!currentUser) {
      return res.status(404).json({ error: "User not found" })
    }

    const pendingMemos = []
    const allUsers = await firebase_get('users')

    if (!allUsers || typeof allUsers !== 'object') {
      return res.json({ pendingMemos: [], count: 0 })
    }

    const senderIds = Object.keys(allUsers)

    // If admin, get all pending approval memos without checking approvers
    if (currentUser.role === 'admin') {
      // ✅ Parallel: fetch all sent_memos ทีเดียว
      const allSentMemosArray = await Promise.all(
        senderIds.map(senderId => firebase_get(`sent_memos/${senderId}`).catch(() => null))
      )

      senderIds.forEach((senderId, idx) => {
        const sender = allUsers[senderId]
        const sentMemos = allSentMemosArray[idx]

        if (!sentMemos || typeof sentMemos !== 'object') return

        for (let memoId in sentMemos) {
          const memo = sentMemos[memoId]

          // Check if memo is pending approval
          if (memo.status === 'pending_approval') {
            pendingMemos.push({
              ...memo,
              senderObject: {
                userId: sender.userId,
                name: sender.name,
                surname: sender.surname,
                department: sender.department,
                department2: sender.department2,
                username: sender.username
              },
              recipientObjects: memo.recipientObjects || []
            })
          }
        }
      })

      // Also check admin's received_memos for R&D project final_approval stage and raw material requests
      const adminReceivedMemos = await firebase_get(`received_memos/${userId}`)
      if (adminReceivedMemos && typeof adminReceivedMemos === 'object') {
        for (let memoId in adminReceivedMemos) {
          const memo = adminReceivedMemos[memoId]
          // Include R&D project memos in final_approval stage
          if (memo.status === 'pending_approval' && memo.isRDProject && memo.stage === 'final_approval') {
            pendingMemos.push({
              ...memo,
              senderObject: {
                userId: memo.senderUserId,
                name: memo.senderName?.split(' ')[0] || memo.senderName || 'Unknown',
                surname: memo.senderName?.split(' ')[1] || '',
                username: memo.senderName
              },
              recipientObjects: memo.recipientObjects || []
            })
          }
          // Include raw material requests (admin sees all stages)
          else if (memo.status === 'pending_approval' && memo.isRawMaterialRequest) {
            pendingMemos.push({
              ...memo,
              senderObject: {
                userId: memo.senderUserId,
                name: memo.senderName?.split(' ')[0] || memo.senderName || 'Unknown',
                surname: memo.senderName?.split(' ')[1] || '',
                username: memo.senderName
              },
              recipientObjects: memo.recipientObjects || []
            })
          }
        }
      }
    } else {
      // Regular approver - check if user is in memoApprovers or R&D Project approver
      // Get all approver assignments for this user
      const approversData = await firebase_get('memoApprovers')
      const userApprovals = []

      if (approversData && typeof approversData === 'object') {
        for (const [key, approval] of Object.entries(approversData)) {
          if (approval.approverId === userId) {
            userApprovals.push(approval)
          }
        }
      }

      // Check if user is R&D Project approver
      const rolesData = await firebase_get('rd_project_roles')
      const isRDProjectApprover = rolesData && rolesData.approverUserId === userId

      // Check if user is Raw Material approver (first or second step)
      const isRawMatFirstApprover = rolesData && rolesData.rawMatFirstApproverId === userId
      const isRawMatSecondApprover = rolesData && rolesData.rawMatApproverId === userId

      // If user is not a memo approver and not an R&D project approver and not a raw material approver, return empty list
      if (userApprovals.length === 0 && !isRDProjectApprover && !isRawMatFirstApprover && !isRawMatSecondApprover) {
        return res.json({ pendingMemos: [], count: 0 })
      }

      // Get all departments mapping for name->UUID conversion
      const allDepartments = await firebase_get('departments')
      const departmentNameToId = {}
      if (allDepartments && typeof allDepartments === 'object') {
        for (const [deptId, dept] of Object.entries(allDepartments)) {
          if (dept.name) {
            departmentNameToId[dept.name] = deptId
          }
        }
      }

      // Get all sub-departments mapping for name->UUID conversion
      const allDepartments2 = await firebase_get('departments2')
      const subDepartmentNameToId = {}
      if (allDepartments2 && typeof allDepartments2 === 'object') {
        for (const [deptId, dept] of Object.entries(allDepartments2)) {
          if (dept.name) {
            subDepartmentNameToId[dept.name] = deptId
          }
        }
      }

      // Get all users' sent_memos to find pending_approval ones (PARALLEL)
      const allSentMemosArray = await Promise.all(
        senderIds.map(senderId => firebase_get(`sent_memos/${senderId}`).catch(() => null))
      )

      // Also check current user's received_memos for R&D project final_approval stage
      const userReceivedMemos = await firebase_get(`received_memos/${userId}`)
      const addedMemoIds = new Set()  // Track memos already added to avoid duplicates

      senderIds.forEach((senderId, idx) => {
        const sender = allUsers[senderId]
        const sentMemos = allSentMemosArray[idx]

        if (!sentMemos || typeof sentMemos !== 'object') return

        for (let memoId in sentMemos) {
          const memo = sentMemos[memoId]

          // Check if memo is pending approval
          if (memo.status === 'pending_approval') {
            // Check if it's an R&D project memo and user is R&D project approver
            if (memo.isRDProject && isRDProjectApprover) {
              pendingMemos.push({
                ...memo,
                senderObject: {
                  userId: sender.userId,
                  name: sender.name,
                  surname: sender.surname,
                  department: sender.department,
                  department2: sender.department2,
                  username: sender.username
                },
                recipientObjects: memo.recipientObjects || []
              })
              addedMemoIds.add(memoId)  // Mark as added to prevent duplicate
            }
            else if (!memo.isRDProject && !memo.isRawMaterialRequest) {
              // Regular memo only - check memoApprovers (skip raw materials - they use received_memos)
              // Convert sender's department name to UUID
              let senderDepartmentId = sender.department
              if (departmentNameToId[sender.department]) {
                senderDepartmentId = departmentNameToId[sender.department]
              }

              // Convert sender's sub-department name to UUID
              let senderSubDepartmentId = sender.department2
              if (subDepartmentNameToId[sender.department2]) {
                senderSubDepartmentId = subDepartmentNameToId[sender.department2]
              }

              // Verify this user is one of the approvers for this sender
              const canApprove = userApprovals.some(approval => {
                const match = approval.departmentId === senderDepartmentId &&
                  (!approval.subDepartmentId || approval.subDepartmentId === senderSubDepartmentId)

                if (!match) {
                }
                return match
              })

              if (canApprove) {
                pendingMemos.push({
                  ...memo,
                  senderObject: {
                    userId: sender.userId,
                    name: sender.name,
                    surname: sender.surname,
                    department: sender.department,
                    department2: sender.department2,
                    username: sender.username
                  },
                  recipientObjects: memo.recipientObjects || []
                })
              }
            }
          }
        }
      })

      // Add R&D project memos from received_memos if user is R&D project approver
      // Also add raw material requests if user is an approver at the appropriate stage
      // Only add memos that weren't already added from sent_memos (to avoid duplicates)
      if ((isRDProjectApprover || isRawMatFirstApprover || isRawMatSecondApprover) && userReceivedMemos && typeof userReceivedMemos === 'object') {
        for (let memoId in userReceivedMemos) {
          // Skip if already added from sent_memos
          if (addedMemoIds.has(memoId)) continue

          const memo = userReceivedMemos[memoId]

          // Include R&D project memos in both marketing_pending and final_approval stages
          if (memo.isRDProject && isRDProjectApprover && memo.status === 'pending_approval' && (memo.stage === 'marketing_pending' || memo.stage === 'final_approval')) {
            pendingMemos.push({
              ...memo,
              senderObject: {
                userId: memo.senderUserId,
                name: memo.senderName?.split(' ')[0] || memo.senderName || 'Unknown',
                surname: memo.senderName?.split(' ')[1] || '',
                username: memo.senderName
              },
              recipientObjects: memo.recipientObjects || []
            })
            addedMemoIds.add(memoId)
          }
          // Include raw material requests at appropriate approval stage only
          else if (memo.isRawMaterialRequest && memo.status === 'pending_approval') {
            let shouldAdd = false

            // Skip if approval is blocked (waiting for previous stage)
            if (memo.approvalBlocked) {
              continue
            }

            // For first approval stage: only show to first approver
            if (memo.approvalStage === 'first_approval' && memo.firstApproverId === userId && isRawMatFirstApprover) {
              shouldAdd = true
            }
            // For second approval stage: only show to second approver
            else if (memo.approvalStage === 'second_approval' && memo.secondApproverId === userId && isRawMatSecondApprover) {
              shouldAdd = true
            }
            // Backward compatibility: if no approvalStage set, show to appropriate approver
            else if (!memo.approvalStage) {
              if (memo.firstApproverId === userId && isRawMatFirstApprover) {
                shouldAdd = true
              }
            }

            if (shouldAdd) {
              pendingMemos.push({
                ...memo,
                senderObject: {
                  userId: memo.senderUserId,
                  name: memo.senderName?.split(' ')[0] || memo.senderName || 'Unknown',
                  surname: memo.senderName?.split(' ')[1] || '',
                  username: memo.senderName
                },
                recipientObjects: memo.recipientObjects || []
              })
              addedMemoIds.add(memoId)
            }
          }
        }
      }
    }

    // Sort by sentAt descending (newest first)
    pendingMemos.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))

    res.json({ pendingMemos, count: pendingMemos.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Approve memo (approve by authorized approver)
app.post("/memo/approve/:memoId", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser) {
      return res.status(404).json({ error: "User not found" })
    }

    const memoId = req.params.memoId
    const { notes } = req.body

    // Find the memo in sent_memos
    const allUsers = await firebase_get('users')
    let memoData = null
    let memoSenderId = null

    if (allUsers && typeof allUsers === 'object') {
      for (let userId in allUsers) {
        const sentMemos = await firebase_get(`sent_memos/${userId}`)
        if (sentMemos && sentMemos[memoId]) {
          memoData = sentMemos[memoId]
          memoSenderId = userId
          break
        }
      }
    }

    if (!memoData) {
      return res.status(404).json({ error: "Memo not found" })
    }

    if (memoData.status !== 'pending_approval') {
      return res.status(400).json({ error: "Memo is not pending approval" })
    }

    // Check if user is authorized to approve this memo
    let isAuthorizedApprover = false

    if (currentUser.role === 'admin') {
      // Admins can approve any memo
      isAuthorizedApprover = true
    } else if (memoData.isRDProject) {
      // Check if user is R&D Project approver (and not the sender)
      if (req.userId !== memoSenderId) {
        const rolesData = await firebase_get('rd_project_roles')
        if (rolesData && rolesData.approverUserId === req.userId) {
          isAuthorizedApprover = true
        }
      }
    } else {
      // Verify current user is an authorized approver via memoApprovers
      // AND is not the sender (user cannot approve their own memo)
      if (req.userId !== memoSenderId) {
        const sender = await firebase_get(`users/${memoSenderId}`)
        const approvers = await firebase_get('memoApprovers')

        // Convert sender's department name to UUID for comparison
        const allDepartments = await firebase_get('departments')
        let senderDepartmentId = sender.department
        if (allDepartments && typeof allDepartments === 'object') {
          for (const [deptId, dept] of Object.entries(allDepartments)) {
            if (dept.name === sender.department) {
              senderDepartmentId = deptId
              break
            }
          }
        }

        // Convert sender's sub-department name to UUID for comparison
        const allDepartments2 = await firebase_get('departments2')
        let senderSubDepartmentId = sender.department2
        if (allDepartments2 && typeof allDepartments2 === 'object') {
          for (const [subDeptId, subDept] of Object.entries(allDepartments2)) {
            if (subDept.name === sender.department2) {
              senderSubDepartmentId = subDeptId
              break
            }
          }
        }

        if (approvers && typeof approvers === 'object') {
          for (const approver of Object.values(approvers)) {
            if (approver.approverId === req.userId &&
              approver.departmentId === senderDepartmentId &&
              (!approver.subDepartmentId || approver.subDepartmentId === senderSubDepartmentId)) {
              isAuthorizedApprover = true
              break
            }
          }
        }
      }
    }

    if (!isAuthorizedApprover) {
      return res.status(403).json({ error: "You are not authorized to approve this memo" })
    }

    // Update memo status
    memoData.status = 'approved'
    memoData.approvalPending = false
    memoData.approvedBy = req.userId
    memoData.approvedByName = `${currentUser.name} ${currentUser.surname}`
    memoData.approvedAt = new Date().toISOString()
    memoData.approvalNotes = notes || ''

    if (!memoData.approvalChain) {
      memoData.approvalChain = []
    }
    memoData.approvalChain.push({
      approverId: req.userId,
      approverName: `${currentUser.name} ${currentUser.surname}`,
      approvedAt: new Date().toISOString(),
      notes: notes || ''
    })

    await firebase_set(`sent_memos/${memoSenderId}/${memoId}`, memoData)

    // Get sender info for notifications
    const senderUser = await firebase_get(`users/${memoSenderId}`)

    // Send to all recipients (support both old single-recipient and new multi-recipient formats)
    const recipientIdsList = memoData.recipientIds && Array.isArray(memoData.recipientIds)
      ? memoData.recipientIds
      : (memoData.recipientId ? [memoData.recipientId] : [])

    // Send LINE to all recipients' linked followers
    for (let recipId of recipientIdsList) {
      const recipientUser = recipId ? await firebase_get(`users/${recipId}`) : null
      let lineFollowerIds = []

      // Collect all linked followers of this recipient
      if (recipientUser && recipientUser.linkedFollowers) {
        lineFollowerIds = Object.keys(recipientUser.linkedFollowers)
      }

      // Send LINE message to all linked followers
      if (lineFollowerIds.length > 0) {
        const lineMessage = {
          type: "flex",
          altText: `Approved Memorandum: ${memoData.title}`,
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: "New Memorandum",
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
                  text: memoData.title,
                  weight: "bold",
                  size: "lg",
                  wrap: true,
                  color: "#182034"
                },
                {
                  type: "text",
                  text: `From: ${senderUser.name} ${senderUser.surname}`,
                  size: "sm",
                  color: "#c8a96e",
                  weight: "bold",
                  margin: "md"
                },
                {
                  type: "text",
                  text: `Type: ${memoData.type || 'Announcement'}`,
                  size: "sm",
                  color: "#1a2740",
                  weight: "bold",
                  margin: "md"
                },
                ...(memoData.docNumber ? [{
                  type: "text",
                  text: `Doc No.: ${memoData.docNumber}`,
                  size: "sm",
                  color: "#1a2740",
                  weight: "bold",
                  margin: "md"
                }] : []),
                {
                  type: "text",
                  text: `Status: ✅ Approved`,
                  size: "sm",
                  color: "#1a5c3a",
                  weight: "bold",
                  margin: "md"
                },
                {
                  type: "text",
                  text: `Approved by: ${currentUser.name} ${currentUser.surname}`,
                  size: "sm",
                  color: "#1a5c3a",
                  weight: "bold",
                  margin: "md"
                },
                {
                  type: "separator",
                  margin: "md"
                },
                {
                  type: "text",
                  text: memoData.content.substring(0, 200) + (memoData.content.length > 200 ? '...' : ''),
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
                    uri: "https://rmcmemorandum.onrender.com/"
                  },
                  style: "primary",
                  color: "#1a2740"
                }
              ]
            }
          }
        }

        // Send LINE to all linked followers of this recipient
        for (const followerId of lineFollowerIds) {
          try {
            await client.pushMessage(followerId, lineMessage)
          } catch (lineErr) {
            // Silent error
          }
        }
      }
    }

    // Also handle system user recipients (if exists)
    // Support both old single-recipient and new multi-recipient formats
    const allRecipientIds = memoData.recipientIds && Array.isArray(memoData.recipientIds)
      ? memoData.recipientIds
      : (memoData.recipientId ? [memoData.recipientId] : [])

    for (let recipientId of allRecipientIds) {
      const recipient = await firebase_get(`users/${recipientId}`)
      if (recipient) {
        // Add to received_memos with updated status
        const approvedMemo = {
          ...memoData,
          sentAt: memoData.sentAt,
          status: 'approved',
          approvalPending: false,
          approvedBy: req.userId,
          approvedByName: `${currentUser.name} ${currentUser.surname}`,
          approvedAt: memoData.approvedAt
        }

        await firebase_set(`received_memos/${recipientId}/${memoId}`, approvedMemo)

        // Create notification
        const memoNotification = {
          id: `${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
          memoId: memoId,
          memoType: 'received',
          message: `"${memoData.title}" จาก ${senderUser.name} ${senderUser.surname}`,
          read: false,
          recipientId: recipientId,
          senderId: memoSenderId,
          timestamp: new Date().toISOString(),
          title: 'Memo ได้รับการอนุมัติแล้ว',
          type: 'info'
        }

        await firebase_set(`notifications/${recipientId}/${memoNotification.id}`, memoNotification)
      }
    }

    // Send LINE message to sender's linked followers to notify approval
    if (senderUser && senderUser.linkedFollowers) {
      const senderFollowerIds = Object.keys(senderUser.linkedFollowers)

      if (senderFollowerIds.length > 0) {
        const senderLineMessage = {
          type: "flex",
          altText: `Memo Approved: ${memoData.title}`,
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              contents: [
                {
                  type: "text",
                  text: "✅ Memo Approved",
                  weight: "bold",
                  color: "#1a5c3a",
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
                  text: memoData.title,
                  weight: "bold",
                  size: "lg",
                  wrap: true,
                  color: "#1e2c4e"
                },
                {
                  type: "text",
                  text: `Recipient: ${memoData.recipientName || memoData.recipientNames ? memoData.recipientNames.join(', ') : '-'}`,
                  size: "sm",
                  color: "#1e2c4e",
                  weight: "bold",
                  margin: "md"
                },
                ...(memoData.docNumber ? [{
                  type: "text",
                  text: `Doc No.: ${memoData.docNumber}`,
                  size: "sm",
                  color: "#1e2c4e",
                  weight: "bold",
                  margin: "md"
                }] : []),
                {
                  type: "text",
                  text: `Approved by: ${currentUser.name} ${currentUser.surname}`,
                  size: "sm",
                  color: "#1e2c4e",
                  weight: "bold",
                  margin: "md"
                },
                {
                  type: "separator",
                  margin: "md"
                },
                {
                  type: "text",
                  text: memoData.content.substring(0, 150) + (memoData.content.length > 150 ? '...' : ''),
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
                    uri: "https://rmcmemorandum.onrender.com/"
                  },
                  style: "primary",
                  color: "#1a5c3a"
                }
              ]
            }
          }
        }

        // Send LINE to all linked followers of the sender
        for (const followerId of senderFollowerIds) {
          try {
            await client.pushMessage(followerId, senderLineMessage)
          } catch (lineErr) {
            // Silent error
          }
        }
      }
    }

    // Create notification for sender (to notify that memo was approved)
    const notification = {
      id: Date.now().toString(),
      title: 'Memo ได้รับการอนุมัติแล้ว',
      message: `"${memoData.title}" ได้รับการอนุมัติจาก ${currentUser.name} ${currentUser.surname}`,
      type: 'approved',
      read: false,
      timestamp: new Date().toISOString(),
      memoId: memoId,
      memo: memoData
    }

    try {
      await firebase_set(`notifications/${memoSenderId}/${notification.id}`, notification)
    } catch (err) {
      // Silent error
    }

    addLog('info', 'Approved memo', {
      memoId,
      senderId: memoSenderId,
      approvedBy: req.userId,
      approvedByName: `${currentUser.name} ${currentUser.surname}`,
      docNumber: memoData.docNumber || ''
    });
    res.json({ status: "Memo approved successfully", memoId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// Reject memo
app.post("/memo/reject/:memoId", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser) {
      return res.status(404).json({ error: "User not found" })
    }

    const memoId = req.params.memoId
    const { reason } = req.body

    // reason เป็นตัวเลือก ไม่จำเป็นต้องกรอก
    const rejectionReason = reason || "No reason provided"

    // Find the memo
    const allUsers = await firebase_get('users')
    let memoData = null
    let memoSenderId = null

    if (allUsers && typeof allUsers === 'object') {
      for (let userId in allUsers) {
        const sentMemos = await firebase_get(`sent_memos/${userId}`)
        if (sentMemos && sentMemos[memoId]) {
          memoData = sentMemos[memoId]
          memoSenderId = userId
          break
        }
      }
    }

    if (!memoData) {
      return res.status(404).json({ error: "Memo not found" })
    }

    if (memoData.status !== 'pending_approval') {
      return res.status(400).json({ error: "Memo is not pending approval" })
    }

    // Verify authorization
    const sender = await firebase_get(`users/${memoSenderId}`)
    const approvers = await firebase_get('memoApprovers')

    // Convert sender's department name to UUID for comparison
    const allDepartments = await firebase_get('departments')
    let senderDepartmentId = sender.department
    if (allDepartments && typeof allDepartments === 'object') {
      for (const [deptId, dept] of Object.entries(allDepartments)) {
        if (dept.name === sender.department) {
          senderDepartmentId = deptId
          break
        }
      }
    }

    // Convert sender's sub-department name to UUID for comparison
    const allDepartments2 = await firebase_get('departments2')
    let senderSubDepartmentId = sender.department2
    if (allDepartments2 && typeof allDepartments2 === 'object') {
      for (const [subDeptId, subDept] of Object.entries(allDepartments2)) {
        if (subDept.name === sender.department2) {
          senderSubDepartmentId = subDeptId
          break
        }
      }
    }

    let isAuthorizedApprover = false

    if (approvers && typeof approvers === 'object') {
      for (const approver of Object.values(approvers)) {
        if (approver.approverId === req.userId &&
          approver.departmentId === senderDepartmentId &&
          (!approver.subDepartmentId || approver.subDepartmentId === senderSubDepartmentId)) {
          isAuthorizedApprover = true
          break
        }
      }
    }

    if (!isAuthorizedApprover) {
      return res.status(403).json({ error: "You are not authorized to reject this memo" })
    }

    // Update memo status
    memoData.status = 'rejected'
    memoData.approvalPending = false
    memoData.rejectedBy = req.userId
    memoData.rejectedByName = `${currentUser.name} ${currentUser.surname}`
    memoData.rejectedAt = new Date().toISOString()
    memoData.rejectionReason = rejectionReason

    await firebase_set(`sent_memos/${memoSenderId}/${memoId}`, memoData)

    // Update received_memos for all recipients
    const recipientIdsList = memoData.recipientIds && Array.isArray(memoData.recipientIds)
      ? memoData.recipientIds
      : (memoData.recipientId ? [memoData.recipientId] : [])

    for (let recipientId of recipientIdsList) {
      const rejectedMemo = {
        ...memoData,
        status: 'rejected',
        approvalPending: false,
        rejectedBy: req.userId,
        rejectedByName: `${currentUser.name} ${currentUser.surname}`,
        rejectedAt: memoData.rejectedAt
      }
      await firebase_set(`received_memos/${recipientId}/${memoId}`, rejectedMemo)
    }

    // Notify sender
    const notification = {
      id: Date.now().toString(),
      title: 'Memo ถูกปฏิเสธ',
      message: `"${memoData.title}" ถูกปฏิเสธโดย ${currentUser.name} ${currentUser.surname}: ${rejectionReason}`,
      type: 'rejected',
      read: false,
      timestamp: new Date().toISOString(),
      memoId: memoId,
      memo: memoData
    }

    try {
      await firebase_set(`notifications/${memoSenderId}/${notification.id}`, notification)
    } catch (err) {
      // Silent error
    }

    addLog('info', 'Rejected memo', { memoId, rejectedBy: req.userId, reason: rejectionReason })
    res.json({ status: "Memo rejected", memoId })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ──────────────────────────────────────────────
// Acknowledge Memo (Mark as Read)
// ──────────────────────────────────────────────
app.post("/memo/acknowledge/:memoId", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser) {
      return res.status(404).json({ error: "User not found" })
    }

    const memoId = req.params.memoId
    const { senderUserId } = req.body

    // Find the memo in received_memos first
    let receivedMemo = await firebase_get(`received_memos/${req.userId}/${memoId}`)

    let memoData = null
    let actualSenderId = senderUserId
    let isCCMemo = false

    if (!receivedMemo) {
      // If not in received_memos, search for it in sent_memos (for linked followers)
      const allUsers = await firebase_get('users')
      if (allUsers && typeof allUsers === 'object') {
        for (let userId in allUsers) {
          const sentMemos = await firebase_get(`sent_memos/${userId}`)
          if (sentMemos && sentMemos[memoId]) {
            memoData = sentMemos[memoId]
            actualSenderId = userId
            break
          }
        }
      }
    } else {
      memoData = receivedMemo
      // If senderUserId not provided, try to get it from the memo
      if (!actualSenderId && receivedMemo.senderUserId) {
        actualSenderId = receivedMemo.senderUserId
      }
      // Also check for senderId (for rawmat memos)
      if (!actualSenderId && receivedMemo.senderId) {
        actualSenderId = receivedMemo.senderId
      }

      // Check if this is a CC memo
      isCCMemo = receivedMemo.isCC === true
    }

    if (!memoData) {
      return res.status(404).json({ error: "Memo not found" })
    }

    // For regular memos (not CC), track acknowledgment in the sender's sent memo
    if (!isCCMemo && actualSenderId) {
      const sentMemo = await firebase_get(`sent_memos/${actualSenderId}/${memoId}`)
      if (sentMemo) {
        // Initialize acknowledgments tracking if not exists
        if (!sentMemo.acknowledgments) {
          sentMemo.acknowledgments = {}
        }

        // Track this recipient's acknowledgment
        sentMemo.acknowledgments[req.userId] = {
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
          acknowledgedByName: `${currentUser.name} ${currentUser.surname}`,
          userId: req.userId
        }

        await firebase_set(`sent_memos/${actualSenderId}/${memoId}`, sentMemo)

        // Sync acknowledgments to all other recipients' copies
        if (sentMemo.recipientIds && Array.isArray(sentMemo.recipientIds)) {
          for (const recipientId of sentMemo.recipientIds) {
            if (recipientId !== req.userId) { // Don't update the current user's copy again
              const otherRecipientMemo = await firebase_get(`received_memos/${recipientId}/${memoId}`)
              if (otherRecipientMemo) {
                otherRecipientMemo.acknowledgments = sentMemo.acknowledgments
                await firebase_set(`received_memos/${recipientId}/${memoId}`, otherRecipientMemo)
              }
            }
          }
        }

        // For raw material requests: also update received_memos copies for approvers
        if (sentMemo.isRawMaterialRequest && sentMemo.firstApproverId && sentMemo.secondApproverId) {
          // Update first approver's copy
          const firstApproverMemo = await firebase_get(`received_memos/${sentMemo.firstApproverId}/${memoId}`)
          if (firstApproverMemo) {
            // Copy the acknowledgments from sent_memos
            firstApproverMemo.acknowledgments = sentMemo.acknowledgments
            await firebase_set(`received_memos/${sentMemo.firstApproverId}/${memoId}`, firstApproverMemo)
          }

          // Update second approver's copy
          const secondApproverMemo = await firebase_get(`received_memos/${sentMemo.secondApproverId}/${memoId}`)
          if (secondApproverMemo) {
            // Copy the acknowledgments from sent_memos
            secondApproverMemo.acknowledgments = sentMemo.acknowledgments
            await firebase_set(`received_memos/${sentMemo.secondApproverId}/${memoId}`, secondApproverMemo)
          }
        }
      }
    }
    // For CC memos, track acknowledgment separately in the CC memo sent record (by CC sender)
    else if (isCCMemo && actualSenderId) {
      // For CC memos, we track acknowledgments in a separate ccAcknowledgments field in the CC sender's sent_memos
      const ccSenderMemos = await firebase_get(`sent_memos/${actualSenderId}`)
      if (ccSenderMemos && ccSenderMemos[memoId]) {
        const ccMemoRecord = ccSenderMemos[memoId]

        // Initialize CC acknowledgments tracking if not exists
        if (!ccMemoRecord.ccAcknowledgments) {
          ccMemoRecord.ccAcknowledgments = {}
        }

        // Track this CC recipient's acknowledgment
        ccMemoRecord.ccAcknowledgments[req.userId] = {
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
          acknowledgedByName: `${currentUser.name} ${currentUser.surname}`,
          userId: req.userId
        }

        await firebase_set(`sent_memos/${actualSenderId}/${memoId}`, ccMemoRecord)
      }
    }

    // Update received memo with acknowledgment and copy acknowledgments from sent_memos
    if (receivedMemo) {
      receivedMemo.acknowledged = true
      receivedMemo.acknowledgedAt = new Date().toISOString()
      receivedMemo.acknowledgedBy = req.userId
      receivedMemo.acknowledgedByName = `${currentUser.name} ${currentUser.surname}`

      // Copy acknowledgments from sent_memos based on memo type
      if (isCCMemo && actualSenderId) {
        // For CC memos, copy CC acknowledgments only
        const ccSenderMemos = await firebase_get(`sent_memos/${actualSenderId}`)
        if (ccSenderMemos && ccSenderMemos[memoId] && ccSenderMemos[memoId].ccAcknowledgments) {
          receivedMemo.ccAcknowledgments = ccSenderMemos[memoId].ccAcknowledgments
        }
      } else if (!isCCMemo && actualSenderId) {
        // For regular memos, copy regular acknowledgments only (not CC related)
        const sentMemo = await firebase_get(`sent_memos/${actualSenderId}/${memoId}`)
        if (sentMemo && sentMemo.acknowledgments) {
          receivedMemo.acknowledgments = sentMemo.acknowledgments
        }
      }

      await firebase_set(`received_memos/${req.userId}/${memoId}`, receivedMemo)
    }

    // Send notification to sender (or CC sender for CC memos)
    if (actualSenderId) {
      // Extract feedback from request if provided
      const feedback = req.body.feedback ? req.body.feedback.trim() : null

      // Store feedback in acknowledgmentFeedback if provided and not CC memo
      if (feedback && !isCCMemo) {
        const feedbackData = {
          feedback: feedback,
          feedbackAt: new Date().toISOString(),
          feedbackBy: req.userId,
          feedbackByName: `${currentUser.name} ${currentUser.surname}`
        }

        // Store in sent_memos
        const sentMemo = await firebase_get(`sent_memos/${actualSenderId}/${memoId}`)
        if (sentMemo) {
          if (!sentMemo.acknowledgmentFeedback) {
            sentMemo.acknowledgmentFeedback = {}
          }
          sentMemo.acknowledgmentFeedback[req.userId] = feedbackData
          // Update sent_memos with feedback
          await firebase_set(`sent_memos/${actualSenderId}/${memoId}`, sentMemo)
        }

        // Also store in received_memos for the recipient to see their own feedback
        if (receivedMemo) {
          if (!receivedMemo.acknowledgmentFeedback) {
            receivedMemo.acknowledgmentFeedback = {}
          }
          receivedMemo.acknowledgmentFeedback[req.userId] = feedbackData
          await firebase_set(`received_memos/${req.userId}/${memoId}`, receivedMemo)
        }

        // Sync feedback to all other recipients' copies
        if (sentMemo && sentMemo.recipientIds && Array.isArray(sentMemo.recipientIds)) {
          for (const recipientId of sentMemo.recipientIds) {
            if (recipientId !== req.userId) { // Don't update the current user's copy again
              const otherRecipientMemo = await firebase_get(`received_memos/${recipientId}/${memoId}`)
              if (otherRecipientMemo) {
                if (!otherRecipientMemo.acknowledgmentFeedback) {
                  otherRecipientMemo.acknowledgmentFeedback = {}
                }
                otherRecipientMemo.acknowledgmentFeedback[req.userId] = feedbackData
                await firebase_set(`received_memos/${recipientId}/${memoId}`, otherRecipientMemo)
              }
            }
          }
        }

        // For raw material requests: sync feedback to approvers' copies
        if (sentMemo && sentMemo.isRawMaterialRequest && sentMemo.firstApproverId && sentMemo.secondApproverId) {
          // Update first approver's copy
          const firstApproverMemo = await firebase_get(`received_memos/${sentMemo.firstApproverId}/${memoId}`)
          if (firstApproverMemo) {
            if (!firstApproverMemo.acknowledgmentFeedback) {
              firstApproverMemo.acknowledgmentFeedback = {}
            }
            firstApproverMemo.acknowledgmentFeedback[req.userId] = feedbackData
            await firebase_set(`received_memos/${sentMemo.firstApproverId}/${memoId}`, firstApproverMemo)
          }

          // Update second approver's copy
          const secondApproverMemo = await firebase_get(`received_memos/${sentMemo.secondApproverId}/${memoId}`)
          if (secondApproverMemo) {
            if (!secondApproverMemo.acknowledgmentFeedback) {
              secondApproverMemo.acknowledgmentFeedback = {}
            }
            secondApproverMemo.acknowledgmentFeedback[req.userId] = feedbackData
            await firebase_set(`received_memos/${sentMemo.secondApproverId}/${memoId}`, secondApproverMemo)
          }
        }
      }

      // For CC memos, notify the person who CC'd it; for regular memos, notify the original sender
      const notificationRecipient = isCCMemo ? actualSenderId : actualSenderId

      const notificationTitle = isCCMemo ? 'ผู้รับสำเนาอ่านแล้ว' : 'ผู้รับอ่านเมมโมแล้ว'
      let notificationMessage = isCCMemo
        ? `${currentUser.name} ${currentUser.surname} ได้อ่านสำเนาเมมโมเรื่อง "${memoData.title}"`
        : `${currentUser.name} ${currentUser.surname} ได้อ่านเมมโมเรื่อง "${memoData.title}"`
      
      // Add feedback indicator if feedback was provided
      if (feedback) {
        notificationMessage += ` (พร้อมข้อเสนอแนะ)`
      }

      const notification = {
        id: Date.now().toString(),
        title: notificationTitle,
        message: notificationMessage,
        type: feedback ? 'acknowledged_with_feedback' : 'acknowledged',
        read: false,
        timestamp: new Date().toISOString(),
        memoId: memoId,
        acknowledgedBy: req.userId,
        acknowledgedByName: `${currentUser.name} ${currentUser.surname}`,
        ...(feedback && { feedbackPreview: feedback.substring(0, 100) })
      }

      try {
        await firebase_set(`notifications/${notificationRecipient}/${notification.id}`, notification)
      } catch (err) {
        // Silent error - notification not critical
      }
    }

    addLog('info', 'Acknowledged memo', {
      memoId,
      acknowledgedBy: req.userId,
      acknowledgedByName: `${currentUser.name} ${currentUser.surname}`,
      memoTitle: memoData.title,
      docNumber: memoData.docNumber || '',
      isCC: isCCMemo,
      hasFeedback: !!req.body.feedback
    })
    res.json({ status: "Memo acknowledged", memoId, feedbackStored: !!req.body.feedback })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ──────────────────────────────────────────────
// Tab Access Control System
// ──────────────────────────────────────────────

// Set user tab access
app.post("/admin/user-tabs/set", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const { userId, tabs } = req.body

    if (!userId || !Array.isArray(tabs)) {
      return res.status(400).json({ error: "userId and tabs array required" })
    }

    const user = await firebase_get(`users/${userId}`)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }

    // Always include manage-user (My Account) - all users must have access
    if (!tabs.includes('manage-user')) {
      tabs.push('manage-user')
    }

    // Store tab access configuration
    const tabConfig = {
      userId,
      username: user.username,
      tabs: tabs,  // e.g., ['dashboard', 'compose', 'sent-memos', 'received-memos']
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: req.userId
    }

    await firebase_set(`tabAccess/${userId}`, tabConfig)

    res.json({ status: "Tab access updated", tabConfig })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get user's allowed tabs
app.get("/user/allowed-tabs", verifyToken, async (req, res) => {
  try {
    const userId = req.userId

    const tabAccess = await firebase_get(`tabAccess/${userId}`)

    // If no custom access configured, return default tabs based on role
    if (!tabAccess) {
      const user = await firebase_get(`users/${userId}`)
      const defaultTabs = user.role === 'admin'
        ? ['dashboard', 'compose', 'sent-memos', 'received-memos', 'broadcast', 'followers', 'logs', 'manage-user']
        : ['dashboard', 'compose', 'sent-memos', 'received-memos', 'manage-user']

      return res.json({ tabs: defaultTabs, isCustom: false })
    }

    res.json({ tabs: tabAccess.tabs, isCustom: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get all user tab access (admin only)
app.get("/admin/user-tabs", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const allTabAccess = await firebase_get('tabAccess')
    const allUsers = await firebase_get('users')

    let tabAccessList = []

    // Get all users and their tab access
    if (allUsers && typeof allUsers === 'object') {
      for (const [userId, user] of Object.entries(allUsers)) {
        const userTabAccess = allTabAccess && allTabAccess[userId]

        // If no custom access, return default tabs based on role
        let tabs
        if (!userTabAccess) {
          tabs = user.role === 'admin'
            ? ['dashboard', 'compose', 'sent-memos', 'received-memos', 'broadcast', 'followers', 'logs', 'manage-user']
            : ['dashboard', 'compose', 'sent-memos', 'received-memos', 'manage-user']
        } else {
          tabs = userTabAccess.tabs
        }

        tabAccessList.push({
          userId,
          username: user.username,
          name: `${user.name} ${user.surname}`,
          role: user.role || 'user',
          tabs: tabs,
          isCustom: !!userTabAccess
        })
      }
    }

    res.json({ users: tabAccessList })
  } catch (err) {
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
      return res.status(403).json({ error: 'Invalid signature' })
    }

    // parse JSON body
    const events = JSON.parse(bodyString).events

    await Promise.all(events.map(handleEvent))

    res.status(200).json({ ok: true })
  } catch (err) {
    res.status(200).json({ ok: true, error: err.message })
  }
})

// Handle events จาก LINE และเก็บ userId
async function handleEvent(event) {
  try {
    console.log('📌 Received event:', event.type, event.source?.userId)

    // เมื่อมีคนกด follow
    if (event.type === 'follow') {
      const userId = event.source.userId
      console.log('✅ Follow event - userId:', userId)
      try {
        // ดึง profile จาก LINE
        let profile = null
        try {
          profile = await client.getProfile(userId)
          console.log('✅ Got profile:', profile.displayName)
        } catch (profileErr) {
          console.warn('⚠️ Profile fetch failed:', profileErr.message)
          profile = { displayName: 'Unknown', pictureUrl: null, statusMessage: null }
        }

        const followerData = {
          userId: userId,
          displayName: profile.displayName || 'Unknown',
          pictureUrl: profile.pictureUrl || null,
          statusMessage: profile.statusMessage || null,
          followedAt: new Date().toISOString(),
          status: 'active'
        }

        await firebase_set(`followers/${userId}`, followerData)
        console.log('✅ Follower saved to Firebase')

        // บันทึก log ที่ครบถ้วนเข้า Firebase logs
        console.log('📝 Calling addLog for new follower...')
        addLog('info', 'New followers', {
          userId: userId,
          displayName: profile.displayName || 'Unknown',
          pictureUrl: profile.pictureUrl || null,
          statusMessage: profile.statusMessage || null,
          followedAt: new Date().toISOString()
        })
        console.log('✅ Log added successfully')
      } catch (fbErr) {
        console.error('❌ [FOLLOW ERROR] Failed to handle follow event:', fbErr.message)
        console.error('   Stack:', fbErr.stack)
        console.error('   Event:', event)
      }
    }

    // เมื่อมีคนกด unfollow
    if (event.type === 'unfollow') {
      const userId = event.source.userId
      try {
        // ดึงข้อมูล follower ก่อนลบ
        const followerData = await firebase_get(`followers/${userId}`)

        // ลบออกจาก Firebase
        await firebase_delete(`followers/${userId}`)
        console.log('✅ Follower deleted from Firebase')

        // บันทึก log
        console.log('📝 Calling addLog for unfollow...')
        addLog('info', 'Unfollow/Block', {
          userId: userId,
          displayName: followerData?.displayName || 'Unknown',
          pictureUrl: followerData?.pictureUrl || null,
          unfollowedAt: new Date().toISOString()
        })
        console.log('✅ Unfollow log added successfully')
      } catch (fbErr) {
        console.error('❌ [UNFOLLOW ERROR] Failed to handle unfollow event:', fbErr.message)
        // Silent error handling
      }
    }

    // เมื่อมีคนส่งข้อความ (บันทึก userId เพิ่มเติม)
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId
      try {
        // เก็บ userId ถ้ายังไม่มี
        const exists = await firebase_get(`followers/${userId}`)
        if (!exists) {
          // ดึง profile จาก LINE
          let profile = null
          try {
            profile = await client.getProfile(userId)
          } catch (profileErr) {
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
        }
      } catch (fbErr) {
        // Silent error for message handling
      }
    }
  } catch (err) {
    // Silent error handling
  }
}

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
        errorCount++
      }
    }

    res.json({
      status: "broadcast sent",
      successCount: successCount,
      errorCount: errorCount,
      totalFollowers: Object.keys(followers).length
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get sent memos for current user (or all memos if admin)
app.get("/sent-memos", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const currentUser = await firebase_get(`users/${userId}`)
    const allUsers = await firebase_get('users')

    let memosArray = []

    // If admin, get all sent memos from all users (PARALLEL)
    if (currentUser && currentUser.role === 'admin') {
      if (allUsers && typeof allUsers === 'object') {
        const userIds = Object.keys(allUsers)
        // ✅ Parallel: fetch all sent_memos ทีเดียว
        const allSentMemosArray = await Promise.all(
          userIds.map(uid => firebase_get(`sent_memos/${uid}`).catch(() => null))
        )

        allSentMemosArray.forEach(sentMemos => {
          if (sentMemos && typeof sentMemos === 'object') {
            memosArray.push(...Object.values(sentMemos))
          }
        })
      }
    } else {
      // Regular user gets only their own sent memos
      const sentMemos = await firebase_get(`sent_memos/${userId}`)
      if (sentMemos && typeof sentMemos === 'object') {
        memosArray.push(...Object.values(sentMemos))
      }
    }

    if (memosArray.length === 0) {
      return res.json({ memos: [], count: 0 })
    }

    memosArray.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))

    // Build follower lookup map (instead of nested loop)
    const followerToUserMap = {}
    if (allUsers && typeof allUsers === 'object') {
      for (let uid in allUsers) {
        const user = allUsers[uid]
        if (user.linkedFollowers && typeof user.linkedFollowers === 'object') {
          for (let followerId in user.linkedFollowers) {
            followerToUserMap[followerId] = user
          }
        }
      }
    }

    // Enrich each memo with recipient name
    for (let memo of memosArray) {
      try {
        // CC Memo: enrich recipientName(s) from ccRecipientObjects
        if (memo.isCC && Array.isArray(memo.ccRecipientObjects) && memo.ccRecipientObjects.length > 0) {
          // กรณี CC ถึงหลายคน ให้รวมชื่อทั้งหมด
          memo.recipientName = memo.ccRecipientObjects.map(r => `${r.name || ''} ${r.surname || ''}`.trim()).join(', ')
          // สำหรับแสดงจำนวนอ่านแล้ว
          const total = Array.isArray(memo.ccRecipientIds) ? memo.ccRecipientIds.length : memo.ccRecipientObjects.length
          let ack = 0
          if (memo.ccAcknowledgments && typeof memo.ccAcknowledgments === 'object') {
            ack = Object.values(memo.ccAcknowledgments).filter(a => a.acknowledged).length
          }
          memo.ccAcknowledgedCount = ack
          memo.ccTotalRecipients = total
          // Set senderName for CC memo if not already set (fallback for old CC memos in database)
          if (!memo.senderName && memo.ccSenderName) {
            memo.senderName = memo.ccSenderName
          }
        }
        // Handle system user recipient (recipientUserId)
        else if (memo.recipientUserId && allUsers) {
          const recipientUser = allUsers[memo.recipientUserId]
          if (recipientUser) {
            memo.recipientName = `${recipientUser.name} ${recipientUser.surname}`
          }
        }
        // Handle LINE follower recipient (recipientId) - use lookup map
        else if (memo.recipientId && followerToUserMap[memo.recipientId]) {
          const user = followerToUserMap[memo.recipientId]
          memo.recipientName = `${user.name} ${user.surname}`
        }
      } catch (e) {
        // Could not find recipient info
      }
    }

    res.json({ memos: memosArray, count: memosArray.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get received memos for current user (or all received memos if admin)
app.get("/received-memos", verifyToken, async (req, res) => {
  try {
    const userId = req.userId

    // Get current user to access linked followers
    const currentUser = await firebase_get(`users/${userId}`)
    const allUsers = await firebase_get('users')

    const receivedMemos = []
    const seenMemoIds = new Set() // Track already added memos to avoid duplicates

    if (!allUsers || typeof allUsers !== 'object') {
      return res.json({ memos: [], count: 0 })
    }

    const senderIds = Object.keys(allUsers)

    // If admin, get all memos sent to any follower
    if (currentUser && currentUser.role === 'admin') {
      // ✅ Parallel: fetch all sent_memos ทีเดียว
      const allSentMemosArray = await Promise.all(
        senderIds.map(senderId => firebase_get(`sent_memos/${senderId}`).catch(() => null))
      )

      senderIds.forEach((senderId, idx) => {
        const senderMemos = allSentMemosArray[idx]
        if (!senderMemos || typeof senderMemos !== 'object') return

        for (let memoId in senderMemos) {
          const memo = senderMemos[memoId]
          // For admin: get ALL memos (both to LINE followers and system users)
          const sender = allUsers[senderId]
          if (sender) {
            memo.senderName = `${sender.name} ${sender.surname}`
            memo.senderUserId = senderId
          }
          if (!seenMemoIds.has(memoId)) {
            receivedMemos.push(memo)
            seenMemoIds.add(memoId)
          }
        }
      })

      // ✅ Parallel: fetch all received_memos ทีเดียว
      const allReceivedArray = await Promise.all(
        senderIds.map(uid => firebase_get(`received_memos/${uid}`).catch(() => null))
      )

      senderIds.forEach((uid, idx) => {
        const directReceivedMemos = allReceivedArray[idx]
        if (directReceivedMemos && typeof directReceivedMemos === 'object') {
          for (let memoId in directReceivedMemos) {
            const memo = directReceivedMemos[memoId]
            if (!seenMemoIds.has(memoId)) {
              // For CC memos, set senderName from ccSenderName if not already set
              if (memo.isCC && !memo.senderName && memo.ccSenderName) {
                memo.senderName = memo.ccSenderName
              }
              receivedMemos.push(memo)
              seenMemoIds.add(memoId)
            }
          }
        }
      })
    } else {
      // Regular user gets memos for their linked followers
      const linkedFollowerIds = currentUser?.linkedFollowers ? Object.keys(currentUser.linkedFollowers) : []

      if (linkedFollowerIds.length > 0) {
        // ✅ Parallel: fetch all sent_memos ทีเดียว
        const allSentMemosArray = await Promise.all(
          senderIds.map(senderId => firebase_get(`sent_memos/${senderId}`).catch(() => null))
        )

        senderIds.forEach((senderId, idx) => {
          const senderMemos = allSentMemosArray[idx]
          if (!senderMemos || typeof senderMemos !== 'object') return

          for (let memoId in senderMemos) {
            const memo = senderMemos[memoId]
            if (linkedFollowerIds.includes(memo.recipientId)) {
              const sender = allUsers[senderId]
              if (sender) {
                memo.senderName = `${sender.name} ${sender.surname}`
                memo.senderUserId = senderId
              }
              if (!seenMemoIds.has(memoId)) {
                receivedMemos.push(memo)
                seenMemoIds.add(memoId)
              }
            }
          }
        })
      }

      // Direct received memos
      const directReceivedMemos = await firebase_get(`received_memos/${userId}`)
      if (directReceivedMemos && typeof directReceivedMemos === 'object') {
        for (let memoId in directReceivedMemos) {
          if (!seenMemoIds.has(memoId)) {
            const directMemo = directReceivedMemos[memoId]
            // Set senderName if not already set
            if (!directMemo.senderName) {
              // For CC memos, use ccSenderName; for regular memos, use senderId
              if (directMemo.isCC && directMemo.ccSenderName) {
                directMemo.senderName = directMemo.ccSenderName
              } else if (directMemo.senderId) {
                const sender = allUsers[directMemo.senderId]
                if (sender) {
                  directMemo.senderName = `${sender.name} ${sender.surname}`
                  directMemo.senderUserId = directMemo.senderId
                }
              }
            }
            receivedMemos.push(directMemo)
            seenMemoIds.add(memoId)
          }
        }
      }

      // ✅ NEW: Include memos where current user has approved or rejected
      // Fetch all sent_memos to find memos where user is in approvalChain or rejected
      const allSentMemosArray = await Promise.all(
        senderIds.map(senderId => firebase_get(`sent_memos/${senderId}`).catch(() => null))
      )

      senderIds.forEach((senderId, idx) => {
        const senderMemos = allSentMemosArray[idx]
        if (!senderMemos || typeof senderMemos !== 'object') return

        for (let memoId in senderMemos) {
          const memo = senderMemos[memoId]

          // Check if user is in approval chain (approved the memo)
          let userApprovedThisMemo = false
          if (memo.approvalChain && Array.isArray(memo.approvalChain)) {
            userApprovedThisMemo = memo.approvalChain.some(approval => approval.approverId === userId)
          }

          // Check if user rejected this memo
          const userRejectedThisMemo = memo.rejectedBy === userId

          // If user approved or rejected this memo, include it (but avoid duplicates)
          if ((userApprovedThisMemo || userRejectedThisMemo) && !seenMemoIds.has(memoId)) {
            const sender = allUsers[senderId]
            if (sender) {
              memo.senderName = `${sender.name} ${sender.surname}`
              memo.senderUserId = senderId
            }
            memo.isApprovedByCurrentUser = userApprovedThisMemo
            memo.isRejectedByCurrentUser = userRejectedThisMemo
            receivedMemos.push(memo)
            seenMemoIds.add(memoId)
          }
        }
      })
    }

    // Sort by sentAt descending (newest first)
    receivedMemos.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))

    res.json({ memos: receivedMemos, count: receivedMemos.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Get Memo Info by ID ─────────────────────────────────
// Public endpoint to get memo information (for log rendering)
app.get("/memo/:memoId", async (req, res) => {
  try {
    const memoId = req.params.memoId

    // Search in all users' sent_memos and received_memos
    const allUsers = await firebase_get('users')
    if (!allUsers || typeof allUsers !== 'object') {
      return res.status(404).json({ error: 'Memo not found' })
    }

    // Search in sent_memos
    for (const [uid, userObj] of Object.entries(allUsers)) {
      const sentMemos = await firebase_get(`sent_memos/${uid}`)
      if (sentMemos && sentMemos[memoId]) {
        return res.json({
          memoId,
          docNumber: sentMemos[memoId].docNumber || '',
          title: sentMemos[memoId].title || '',
          type: sentMemos[memoId].type || '',
          found: true
        })
      }
    }

    // Search in received_memos
    for (const [uid, userObj] of Object.entries(allUsers)) {
      const receivedMemos = await firebase_get(`received_memos/${uid}`)
      if (receivedMemos && receivedMemos[memoId]) {
        return res.json({
          memoId,
          docNumber: receivedMemos[memoId].docNumber || '',
          title: receivedMemos[memoId].title || '',
          type: receivedMemos[memoId].type || '',
          found: true
        })
      }
    }

    res.status(404).json({ error: 'Memo not found' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Admin: Edit Memo ────────────────────────────────────
app.put("/memo/:memoId", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const memoId = req.params.memoId
    const { docNumber, title, type, content } = req.body

    // Get current user
    const user = await firebase_get(`users/${userId}`)
    if (!user) {
      return res.status(401).json({ error: 'User not found' })
    }

    if (!docNumber || !title || !content) {
      return res.status(400).json({ error: 'Document number, title and content are required' })
    }

    // Find the memo - it could be in any user's sent_memos or received_memos
    const allUsers = await firebase_get('users')
    if (!allUsers || typeof allUsers !== 'object') {
      return res.status(404).json({ error: 'Memo not found' })
    }

    let memoFound = false
    let memoPath = null
    let isReceivedMemo = false
    let existingMemo = null

    // First, search in sent_memos
    for (const [uid, userObj] of Object.entries(allUsers)) {
      const sentMemos = await firebase_get(`sent_memos/${uid}`)
      if (sentMemos && sentMemos[memoId]) {
        memoPath = `sent_memos/${uid}/${memoId}`
        existingMemo = sentMemos[memoId]
        memoFound = true
        break
      }
    }

    // If not found in sent_memos, search in received_memos
    if (!memoFound) {
      for (const [uid, userObj] of Object.entries(allUsers)) {
        const receivedMemos = await firebase_get(`received_memos/${uid}`)
        if (receivedMemos && receivedMemos[memoId]) {
          memoPath = `received_memos/${uid}/${memoId}`
          existingMemo = receivedMemos[memoId]
          memoFound = true
          isReceivedMemo = true
          break
        }
      }
    }

    if (!memoFound) {
      return res.status(404).json({ error: 'Memo not found' })
    }

    // Check authorization:
    // - Admin can edit any memo
    // - Memo sender can edit only if memo status is 'pending_approval'
    const isAdmin = user.role === 'admin'
    const isSender = userId === existingMemo.senderUserId
    const isPendingApproval = existingMemo.status === 'pending_approval'
    const canEdit = isAdmin || (isSender && isPendingApproval)

    if (!canEdit) {
      return res.status(403).json({ error: 'Only administrators or memo senders (before approval) can edit memos' })
    }
    const oldDocNumber = existingMemo.docNumber

    // Check for duplicate docNumber if it's being changed
    if (docNumber !== oldDocNumber) {
      const allUsers = await firebase_get('users')
      if (allUsers && typeof allUsers === 'object') {
        for (const [uid, userObj] of Object.entries(allUsers)) {
          const sentMemos = await firebase_get(`sent_memos/${uid}`)
          if (sentMemos && typeof sentMemos === 'object') {
            for (const [sentMemoId, sentMemo] of Object.entries(sentMemos)) {
              if (sentMemo.docNumber === docNumber && sentMemoId !== memoId) {
                return res.status(400).json({ error: `Document number "${docNumber}" is already in use` })
              }
            }
          }
        }
      }
    }

    // Update title, type, content, and docNumber
    const updatedMemo = {
      ...existingMemo,
      docNumber: docNumber,
      title: title,
      type: type || 'เพื่อโปรดทราบ',
      content: content,
      updatedAt: new Date().toISOString(),
      updatedBy: userId
    }

    // Save updated memo in sent_memos
    await firebase_set(memoPath, updatedMemo)

    // Update all received_memos with the OLD docNumber to use the NEW docNumber
    if (oldDocNumber) {
      const allUsers = await firebase_get('users')
      if (allUsers && typeof allUsers === 'object') {
        for (const [uid, userObj] of Object.entries(allUsers)) {
          const receivedMemos = await firebase_get(`received_memos/${uid}`)
          if (receivedMemos && typeof receivedMemos === 'object') {
            for (const [receivedMemoId, receivedMemo] of Object.entries(receivedMemos)) {
              // Check if this received memo has the same OLD docNumber
              if (receivedMemo.docNumber === oldDocNumber) {
                const updatedReceivedMemo = {
                  ...receivedMemo,
                  docNumber: docNumber,
                  title: title,
                  type: type || 'เพื่อโปรดทราบ',
                  content: content,
                  updatedAt: new Date().toISOString(),
                  updatedBy: userId
                }
                await firebase_set(`received_memos/${uid}/${receivedMemoId}`, updatedReceivedMemo)
              }
            }
          }
        }
      }
    }

    // Log activity
    addLog('info', 'Memo edited', {
      memoId,
      editedBy: userId,
      editedByName: `${user.name} ${user.surname}`,
      docNumber: docNumber,
      title: title
    })

    res.json({ success: true, message: 'Memo updated successfully' })
  } catch (err) {
    console.error('Error editing memo:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Admin: Delete Memo ──────────────────────────────────
app.delete("/memo/:memoId", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const memoId = req.params.memoId

    // Get current user
    const user = await firebase_get(`users/${userId}`)
    if (!user) {
      return res.status(401).json({ error: 'User not found' })
    }

    // Find the memo - it could be in any user's sent_memos or received_memos
    const allUsers = await firebase_get('users')
    if (!allUsers || typeof allUsers !== 'object') {
      return res.status(404).json({ error: 'Memo not found' })
    }

    let memoFound = false
    let memoPath = null
    let memoData = null
    let isReceivedMemo = false
    let memoOwnerUserId = null

    // Search in sent_memos first
    for (const [uid, userObj] of Object.entries(allUsers)) {
      const sentMemos = await firebase_get(`sent_memos/${uid}`)
      if (sentMemos && sentMemos[memoId]) {
        memoPath = `sent_memos/${uid}/${memoId}`
        memoData = sentMemos[memoId]
        memoFound = true
        memoOwnerUserId = uid
        break
      }
    }

    // If not found in sent_memos, search in received_memos
    if (!memoFound) {
      for (const [uid, userObj] of Object.entries(allUsers)) {
        const receivedMemos = await firebase_get(`received_memos/${uid}`)
        if (receivedMemos && receivedMemos[memoId]) {
          memoPath = `received_memos/${uid}/${memoId}`
          memoData = receivedMemos[memoId]
          memoFound = true
          isReceivedMemo = true
          memoOwnerUserId = uid
          break
        }
      }
    }

    if (!memoFound) {
      return res.status(404).json({ error: 'Memo not found' })
    }

    // Check authorization:
    // - Admin can delete any memo
    // - Memo sender can delete only if memo status is 'pending_approval'
    const isAdmin = user.role === 'admin'
    const isSender = userId === memoData.senderUserId
    const isPendingApproval = memoData.status === 'pending_approval'
    const canDelete = isAdmin || (isSender && isPendingApproval)

    if (!canDelete) {
      return res.status(403).json({ error: 'Only administrators or memo senders (before approval) can delete memos' })
    }

    // Delete from the found path
    await firebase_delete(memoPath)

    // If deleted from sent_memos, also delete all related received_memos with the same docNumber
    // If deleted from received_memos, only delete that one memo
    if (!isReceivedMemo) {
      const docNumber = memoData?.docNumber
      if (docNumber) {
        const allUsers = await firebase_get('users')
        if (allUsers && typeof allUsers === 'object') {
          for (const [uid, userObj] of Object.entries(allUsers)) {
            const receivedMemos = await firebase_get(`received_memos/${uid}`)
            if (receivedMemos && typeof receivedMemos === 'object') {
              for (const [receivedMemoId, receivedMemo] of Object.entries(receivedMemos)) {
                // Delete if docNumber matches
                if (receivedMemo.docNumber === docNumber) {
                  try {
                    await firebase_delete(`received_memos/${uid}/${receivedMemoId}`)
                  } catch (e) {
                    // Silent error - memo might not exist
                  }
                }
              }
            }
          }
        }
      }
    }

    // Also delete if it was sent via recipientIds (backward compatibility)
    if (memoData && memoData.recipientIds && Array.isArray(memoData.recipientIds)) {
      for (const recipientId of memoData.recipientIds) {
        try {
          await firebase_delete(`received_memos/${recipientId}/${memoId}`)
        } catch (e) {
          // Silent error - memo might not exist in received
        }
      }
    }

    // Log activity
    addLog('info', 'Deleted memo', {
      memoId,
      docNumber: memoData?.docNumber || '',
      title: memoData?.title || 'Unknown',
      deletedBy: user.username,
      deletedByName: `${user.name} ${user.surname}`
    })

    res.json({ success: true, message: 'Memo deleted successfully' })
  } catch (err) {
    console.error('Error deleting memo:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── CC Memo to other users ──────────────────────────────
app.post("/memo/:memoId/cc", verifyToken, async (req, res) => {
  try {
    const memoId = req.params.memoId
    const { recipientIds } = req.body

    if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
      return res.status(400).json({ error: 'recipientIds must be a non-empty array' })
    }

    // Get the memo from sent_memos or received_memos
    let memo = null
    let senderUserId = req.userId
    const currentUser = await firebase_get(`users/${req.userId}`)

    // Try to find memo in sender's sent_memos first
    memo = await firebase_get(`sent_memos/${req.userId}/${memoId}`)

    if (!memo) {
      // Try to find in received_memos
      memo = await firebase_get(`received_memos/${req.userId}/${memoId}`)
      if (memo) {
        senderUserId = memo?.senderId || req.userId
      }
    }

    // If still not found and user is admin, search in all users' sent_memos
    if (!memo && currentUser && currentUser.role === 'admin') {
      const allUsers = await firebase_get('users')
      if (allUsers && typeof allUsers === 'object') {
        for (const userId in allUsers) {
          memo = await firebase_get(`sent_memos/${userId}/${memoId}`)
          if (memo) {
            senderUserId = memo.senderId || userId
            break
          }
        }
      }
    }

    if (!memo) {
      return res.status(404).json({ error: 'Memo not found' })
    }

    // Allow CC if:
    // 1. Memo is approved (regular memos)
    // 2. Memo is R&D project with completed status
    // 3. Memo is Raw Material with acknowledged status
    // 4. Memo is sent without approval requirement
    // 5. Current user is the sender (can CC any memo they sent)
    // 6. Current user is admin (can CC approved/completed memos)
    const isApprovedMemo = memo.status === 'approved'
    const isCompletedRDProject = memo.isRDProject && memo.status === 'completed'
    const isAcknowledgedRawMat = (memo.isRawMaterialRequest || memo.type === 'Raw Material Request') && memo.status === 'acknowledged'
    const isSentMemo = memo.status === 'sent' && !memo.isRDProject && !memo.isRawMaterialRequest
    const isSender = memo.senderId === req.userId
    const isAdmin = currentUser && currentUser.role === 'admin'

    // Determine if user can CC this memo
    const canCC = isApprovedMemo || isCompletedRDProject || isAcknowledgedRawMat || isSentMemo || isSender || (isAdmin && (isApprovedMemo || isCompletedRDProject || isAcknowledgedRawMat))

    if (!canCC) {
      return res.status(403).json({ error: 'This memo cannot be CCed' })
    }

    const sender = currentUser  // Use already fetched currentUser

    // Build CC recipient objects array with full user information
    const ccRecipientObjects = []
    for (const recipientId of recipientIds) {
      const recipient = await firebase_get(`users/${recipientId}`)
      if (recipient) {
        ccRecipientObjects.push({
          userId: recipientId,
          name: recipient.name,
          surname: recipient.surname,
          username: recipient.username,
          department: recipient.department,
          department2: recipient.department2
        })
      }
    }

    // Send CC to each recipient
    for (const recipientId of recipientIds) {
      // Create unique ccMemoKey for each recipient to avoid overwrites
      const ccMemoKey = `${memoId}_cc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const ccMemo = {
        memoId: memoId,
        memoKey: ccMemoKey,
        type: memo.type || 'Memorandum',
        title: memo.title,
        content: memo.content,
        documentNo: memo.documentNo || memo.docNumber || '',
        docNumber: memo.docNumber || memo.documentNo || '',
        sentAt: new Date().toISOString(),
        recipientId: recipientId,
        recipientIds: [recipientId],
        isCC: true,
        // CC Sender Information
        ccSenderId: req.userId,
        ccSenderName: sender ? `${sender.name} ${sender.surname}` : 'Unknown',
        senderName: sender ? `${sender.name} ${sender.surname}` : 'Unknown',
        senderUserId: req.userId,
        ccSenderObject: sender ? {
          userId: req.userId,
          name: sender.name,
          surname: sender.surname,
          username: sender.username,
          department: sender.department,
          department2: sender.department2
        } : null,
        // CC Recipients
        ccRecipientIds: recipientIds,
        ccRecipientObjects: ccRecipientObjects,
        // Original Memo Information (preserved)
        originalSenderId: memo.senderId || memo.senderUserId,
        originalSenderName: memo.senderName || '',
        originalSenderObject: memo.senderObject || null,
        originalRecipientIds: memo.recipientIds || [],
        originalRecipientObjects: memo.recipientObjects || [],
        // Original memo status
        approvedByName: memo.approvedByName || '',
        approvedAt: memo.approvedAt || new Date().toISOString(),
        imageUrl: memo.imageUrl || '',
        imageUrls: memo.imageUrls || (memo.imageUrl ? [memo.imageUrl] : null)
      }

      // Save CC memo to receiver's received_memos
      await firebase_set(`received_memos/${recipientId}/${ccMemoKey}`, ccMemo)

      // Also save CC memo to sender's sent_memos (so sender can see what they CC'd)
      // This is important so that the person who CC'd the memo can see it in their sent list
      await firebase_set(`sent_memos/${req.userId}/${ccMemoKey}`, ccMemo)

      // Create notification for CC recipient
      const ccSenderName = sender ? `${sender.name} ${sender.surname}` : 'Unknown'
      const notificationTitle = `สำเนา: ${memo.title}`
      const notificationMessage = `จาก: ${ccSenderName}`

      try {
        await firebase_set(`notifications/${recipientId}/${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, {
          title: notificationTitle,
          message: notificationMessage,
          type: 'cc',
          titleKey: 'ccMemoNotification',
          messageKey: 'ccMemoFrom',
          memoId: memoId,
          memoKey: ccMemoKey,
          memoType: 'received',
          read: false,
          timestamp: new Date().toISOString()
        })
      } catch (notifErr) {
        // Silent error - notification not critical
        console.log('Silent: Could not create notification:', notifErr.message)
      }

      // Send LINE notification if recipient is linked to LINE
      try {
        const recipient = await firebase_get(`users/${recipientId}`)
        if (recipient && recipient.linkedFollowers && typeof recipient.linkedFollowers === 'object') {
          // Get all LINE followers for this recipient
          for (const followerId in recipient.linkedFollowers) {
            if (recipient.linkedFollowers.hasOwnProperty(followerId)) {
              try {
                // Build LINE message for CC notification
                const memoTitle = memo.title || 'Untitled Memo'
                const ccSenderName = sender ? `${sender.name} ${sender.surname}` : 'Unknown'
                const memoContent = typeof memo.content === 'string'
                  ? memo.content.substring(0, 100)
                  : JSON.stringify(memo.content).substring(0, 100)

                const lineMessage = {
                  type: "flex",
                  altText: `📋 สำเนา: ${memoTitle} จาก ${ccSenderName}`,
                  contents: {
                    type: "bubble",
                    header: {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "text",
                          text: `📋 สำเนา: ${memoTitle}`,
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
                          text: memoTitle,
                          weight: "bold",
                          size: "lg",
                          wrap: true,
                          color: "#182034"
                        },
                        {
                          type: "text",
                          text: `จาก: ${ccSenderName}`,
                          size: "sm",
                          color: "#c8a96e",
                          weight: "bold",
                          margin: "md"
                        },
                        {
                          type: "text",
                          text: "ประเภท: สำเนา (CC)",
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
                          text: memoContent,
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
                            label: "ดูรายละเอียด",
                            uri: "https://rmcmemorandum.onrender.com/"
                          },
                          style: "primary",
                          color: "#1a2740"
                        }
                      ]
                    }
                  }
                }

                await client.pushMessage(followerId, lineMessage)
              } catch (lineErr) {
                // Silent error - LINE notification not critical
                console.log(`Silent: Could not send LINE notification to ${followerId}:`, lineErr.message)
              }
            }
          }
        }
      } catch (notifErr) {
        // Silent error - LINE notification is not critical to CC delivery
        console.log('Silent: Error checking for LINE notifications:', notifErr.message)
      }
    }

    addLog('info', 'cc_memo_sent', {
      memoId,
      memoTitle: memo.title,
      docNumber: memo.docNumber || '',
      sentByName: `${sender.name} ${sender.surname}`,
      ccCount: recipientIds.length
    })

    res.json({ success: true, message: 'CC sent successfully' })
  } catch (err) {
    console.error('Error sending CC:', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Notification Endpoints ──────────────────────────────
// Get all notifications for a user
app.get("/notifications", verifyToken, async (req, res) => {
  try {
    const userId = req.userId

    const notificationsData = await firebase_get(`notifications/${userId}`)

    if (!notificationsData || typeof notificationsData !== 'object') {
      return res.json({ notifications: [], count: 0 })
    }

    // Convert to array and sort by timestamp descending (newest first)
    const notificationsArray = Object.values(notificationsData)
    notificationsArray.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

    res.json({ notifications: notificationsArray, count: notificationsArray.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create a new notification
app.post("/notifications", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const { title, message, type, titleKey, messageKey, memoType } = req.body

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
      timestamp: new Date().toISOString(),
      titleKey: titleKey || null,  // Translation key for title
      messageKey: messageKey || null,  // Translation key for message
      memoType: memoType || null  // Memo type (sent, received, etc)
    }

    await firebase_set(`notifications/${userId}/${notificationId}`, notification)

    res.json({ status: 'Notification saved', notification })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Send notification to a specific user (admin only)
app.post("/notifications/send/:targetUserId", verifyToken, async (req, res) => {
  try {
    const { title, message, type, memoType } = req.body
    const targetUserId = req.params.targetUserId
    const senderUserId = req.userId

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
      timestamp: new Date().toISOString(),
      sentBy: senderUserId,
      memoType: memoType || null
    }

    await firebase_set(`notifications/${targetUserId}/${notificationId}`, notification)

    res.json({ status: 'Notification sent', notification })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Send memo to a system user (for users without linked followers)
app.post("/send-system-memo", verifyToken, async (req, res) => {
  try {
    // Support both old single-recipient and new multi-recipient formats
    let recipientsList = []

    if (req.body.recipients && Array.isArray(req.body.recipients)) {
      // New format: multiple recipients
      recipientsList = req.body.recipients
    } else if (req.body.targetUserId) {
      // Old format: single recipient (backward compatibility)
      recipientsList = [{
        userId: req.body.targetUserId,
        recipientUserId: req.body.targetUserId
      }]
    }

    if (recipientsList.length === 0) {
      return res.status(400).json({ error: 'No recipients specified' })
    }

    const { title, type, content, docNumber, imageUrl, imageUrls } = req.body
    const senderUserId = req.userId

    // Support both old format (imageUrl) and new format (imageUrls)
    const finalImageUrls = imageUrls || (imageUrl ? [imageUrl] : [])

    if (!title || !type || !content) {
      return res.status(400).json({ error: 'title, type, and content required' })
    }

    // Resolve any DocNumber conflicts
    let resolvedDocNumber = docNumber
    if (docNumber) {
      resolvedDocNumber = await resolveDocNumberConflict(docNumber, senderUserId)
    }

    // Get sender info
    const sender = await firebase_get(`users/${senderUserId}`)
    if (!sender) {
      return res.status(404).json({ error: 'Sender not found' })
    }

    // Build recipient details for all recipients
    let recipientNames = []
    let recipientIds = []
    let recipientObjects = []

    for (let r of recipientsList) {
      let recipientId = r.recipientUserId || r.userId
      let recipientName = recipientId
      let recipientDepartment = ''
      let recipientDepartment2 = ''

      const recipient = await firebase_get(`users/${recipientId}`)
      if (!recipient) {
        return res.status(404).json({ error: `Recipient ${recipientId} not found` })
      }

      if (recipient) {
        recipientName = `${recipient.name} ${recipient.surname}`.trim() || recipientName
        recipientDepartment = recipient.department || ''
        recipientDepartment2 = recipient.department2 || ''
      }

      recipientNames.push(recipientName)
      recipientIds.push(recipientId)
      recipientObjects.push({
        systemUserId: recipientId,
        name: recipientName,
        department: recipientDepartment,
        department2: recipientDepartment2
      })
    }

    const recipientName = recipientNames.join(', ')
    const primaryRecipientId = recipientIds[0]

    // Create memo ID
    const memoId = `memo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Create memo data
    const memoData = {
      memoId,
      title,
      type,
      content,
      docNumber: resolvedDocNumber || '',
      imageUrls: finalImageUrls && finalImageUrls.length > 0 ? finalImageUrls : null,
      senderUserId,
      senderName: `${sender.name} ${sender.surname}`,
      senderUsername: sender.username,
      senderObject: {
        userId: sender.userId,
        name: sender.name,
        surname: sender.surname,
        username: sender.username,
        department: sender.department || '',
        department2: sender.department2 || ''
      },
      // Multi-recipient support
      recipientIds: recipientIds,  // All system user IDs
      recipientNames: recipientNames,  // All recipient names
      recipientObjects: recipientObjects,  // Full recipient details
      // Backward compatibility - keep primary recipient fields
      recipientUserId: primaryRecipientId,
      sentAt: new Date().toISOString(),
      status: 'pending',
      approvalPending: true,
      approvalChain: []
    }

    // Check if memo requires approval based on sender's department
    let memoApprovers = []
    const senderName = `${sender.name} ${sender.surname}`

    // Look for approvers for this sender's department
    if (sender && sender.department) {
      // First, convert department name to departmentId by looking in departments
      const allDepartments = await firebase_get('departments')
      let senderDepartmentId = sender.department  // Default to stored value

      // Try to find matching department by name
      if (allDepartments && typeof allDepartments === 'object') {
        for (const [deptId, dept] of Object.entries(allDepartments)) {
          if (dept.name === sender.department) {
            senderDepartmentId = deptId
            break
          }
        }
      }

      // Convert department2 name to ID
      const allDepartments2 = await firebase_get('departments2')
      let senderSubDepartmentId = sender.department2

      // Try to find matching sub-department by name
      if (allDepartments2 && typeof allDepartments2 === 'object') {
        for (const [deptId, dept] of Object.entries(allDepartments2)) {
          if (dept.name === sender.department2) {
            senderSubDepartmentId = deptId
            break
          }
        }
      }

      const approvers = await firebase_get('memoApprovers')

      if (approvers && typeof approvers === 'object') {
        for (const [approverKey, approver] of Object.entries(approvers)) {
          // Check if approver can approve for this department
          if (approver.departmentId === senderDepartmentId) {
            // Either approves entire department or this specific sub-department
            const subDeptMatch = !approver.subDepartmentId ? true : (approver.subDepartmentId === senderSubDepartmentId)

            if (subDeptMatch) {
              memoApprovers.push({
                approverId: approver.approverId,
                approverName: approver.approverName,
                approverUsername: approver.approverUsername
              })
            }
          }
        }
      }
    }

    // Check if sender is an approver - if so, bypass approval requirement
    let senderIsApprover = false
    for (const approver of memoApprovers) {
      if (approver.approverId === senderUserId) {
        senderIsApprover = true
        break
      }
    }

    // If approvers found AND sender is NOT an approver, require approval before sending
    if (memoApprovers.length > 0 && !senderIsApprover) {
      memoData.requiresApproval = true
      memoData.approvers = memoApprovers
      memoData.status = 'pending_approval'

      // Store pending memo (NOT SENT YET)
      await firebase_set(`sent_memos/${senderUserId}/${memoId}`, memoData)

      // Create notification for sender to show memo is pending approval
      const senderNotification = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: 'Memo กำลังรอการอนุมัติ',
        message: `"${title}" กำลังรอการอนุมัติ`,
        type: 'pending_approval',
        read: false,
        timestamp: new Date().toISOString(),
        memoId: memoId,
        memo: memoData,
        senderId: senderUserId,
        recipientId: primaryRecipientId
      }

      try {
        await firebase_set(`notifications/${senderUserId}/${senderNotification.id}`, senderNotification)
      } catch (err) {
        // Silent error
      }

      // Create notifications for approvers and send LINE messages
      for (const approver of memoApprovers) {
        const notification = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          title: 'Memo Requires Approval',
          message: `"${title}" from ${senderName} requires your approval`,
          type: 'pending_approval',
          read: false,
          timestamp: new Date().toISOString(),
          memoId: memoId,
          memo: memoData,
          senderId: senderUserId,
          recipientId: primaryRecipientId
        }

        try {
          await firebase_set(`notifications/${approver.approverId}/${notification.id}`, notification)
        } catch (err) {
          // Silent error
        }

        // Send LINE message to approver
        try {
          const approverUser = await firebase_get(`users/${approver.approverId}`)

          if (approverUser) {
            const approverFollowerIds = approverUser.linkedFollowers ? Object.keys(approverUser.linkedFollowers) : []

            // Create LINE message for approver (with approval request)
            const approverLineMessage = {
              type: "flex",
              altText: `Memorandum Requires Approval: ${title}`,
              contents: {
                type: "bubble",
                header: {
                  type: "box",
                  layout: "vertical",
                  contents: [
                    {
                      type: "text",
                      text: "Requires Approval",
                      weight: "bold",
                      color: "#1e2c4e",
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
                      color: "#1e2c4e"
                    },
                    {
                      type: "text",
                      text: `From: ${senderName}`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    },
                    ...(resolvedDocNumber ? [{
                      type: "text",
                      text: `Doc No.: ${resolvedDocNumber}`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    }] : []),
                    {
                      type: "text",
                      text: `Status: ⏳ Pending Approval`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    },

                    {
                      type: "text",
                      text: `Recipient: ${recipientName}`,
                      size: "sm",
                      color: "#1e2c4e",
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
                      color: "#1e2c4e",
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
                        uri: "https://rmcmemorandum.onrender.com/"
                      },
                      style: "primary",
                      color: "#1e2c4e"
                    }
                  ]
                }
              }
            }

            if (approverFollowerIds.length > 0) {
              // Send to all linked followers of the approver
              for (const approverFollowerId of approverFollowerIds) {
                try {
                  await client.pushMessage(approverFollowerId, approverLineMessage)
                } catch (lineErr) {
                  // Silent error
                }
              }
            }
          }
        } catch (err) {
          // Silent error
        }
      }

      // Log pending approval memo
      addLog('info', 'Send memo (pending approval)', { title, type, recipientIds, senderName, approverCount: memoApprovers.length })
      return res.json({ status: "Memo created - pending approval", memoId, approverCount: memoApprovers.length })
    }

    // No approvers found - send directly to recipients
    memoData.status = 'sent'
    memoData.approvalPending = false
    memoData.sentTime = new Date().toISOString()

    // Store in sender's sent_memos
    await firebase_set(`sent_memos/${senderUserId}/${memoId}`, memoData)

    // Store in all recipients' received_memos
    for (let recipientId of recipientIds) {
      await firebase_set(`received_memos/${recipientId}/${memoId}`, memoData)
    }

    // Create notifications for all recipients
    for (let i = 0; i < recipientIds.length; i++) {
      const recipientId = recipientIds[i]
      const notification = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        title: 'ได้รับ Memo ใหม่',
        message: `"${title}" จาก ${senderName}`,
        type: 'info',
        read: false,
        timestamp: new Date().toISOString(),
        memoId: memoId,
        memoType: 'received',
        senderId: senderUserId,
        recipientIds: recipientIds,
        recipientId: recipientId
      }
      await firebase_set(`notifications/${recipientId}/${notification.id}`, notification)
    }

    // Create notification for sender (memo sent successfully)
    const senderNotif = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      title: 'ส่ง Memo สำเร็จ',
      message: `ส่ง "${title}" ไปยัง ${recipientName}`,
      type: 'success',
      read: false,
      timestamp: new Date().toISOString(),
      memoId: memoId,
      memoType: 'sent',
      senderId: senderUserId,
      recipientIds: recipientIds
    }
    try {
      await firebase_set(`notifications/${senderUserId}/${senderNotif.id}`, senderNotif)
    } catch (err) {
      // Silent error
    }

    addLog('info', 'Send memo', { title, type, recipientIds, senderName })
    res.json({ status: 'Memo sent successfully', memoId })
  } catch (err) {
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

    res.json({ status: 'Notification updated', notification: { ...notification, read: true } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete a notification
app.delete("/notifications/:id", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const notificationId = req.params.id

    await firebase_delete(`notifications/${userId}/${notificationId}`)

    res.json({ status: 'Notification deleted' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete all notifications
app.delete("/notifications", verifyToken, async (req, res) => {
  try {
    const userId = req.userId

    await firebase_delete(`notifications/${userId}`)

    res.json({ status: 'All notifications cleared' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get followers list
app.get("/followers", async (req, res) => {
  try {
    const followers = await firebase_get("followers")

    if (!followers || typeof followers !== 'object') {
      return res.json({
        followers: {},
        count: 0
      })
    }

    res.json({
      followers: followers,
      count: Object.keys(followers).length
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Refresh profile for a specific user
app.post("/refresh-profile/:userId", async (req, res) => {
  const userId = req.params.userId
  try {
    // ดึง profile จาก LINE
    const profile = await client.getProfile(userId)

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
    res.status(500).json({ error: err.message })
  }
})

// Refresh all profiles
app.post("/refresh-all-profiles", async (req, res) => {
  try {
    const followers = await firebase_get("followers")
    if (!followers || typeof followers !== 'object') {
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
      } catch (err) {
        failed++
      }
    }

    res.json({
      status: "Refresh complete",
      refreshed: refreshed,
      failed: failed,
      total: Object.keys(followers).length
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Test endpoint - เพิ่ม follower สำหรับทดสอบ
app.post("/test-add-follower", async (req, res) => {
  try {
    const testUserId = "Ue78fdf247dea19fe8ef461f8645ef746"

    const result = await firebase_set(`followers/${testUserId}`, {
      userId: testUserId,
      followedAt: new Date().toISOString(),
      status: 'active'
    })

    res.json({ status: "Test follower added", userId: testUserId, firebaseResponse: result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Debug endpoint - ตรวจสอบ Firebase
app.get("/debug", async (req, res) => {
  try {
    const followers = await firebase_get("followers")

    res.json({
      status: "debug",
      firebaseUrl: FIREBASE_DB_URL,
      followersData: followers,
      followersCount: followers && typeof followers === 'object' ? Object.keys(followers).length : 0
    })
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

// Debug endpoint - ตรวจสอบ memo approval setup
app.get("/debug/memo-approval/:senderUserId", async (req, res) => {
  try {
    const { senderUserId } = req.params

    const sender = await firebase_get(`users/${senderUserId}`)
    const approvers = await firebase_get('memoApprovers')

    let matchedApprovers = []

    if (sender && sender.department && approvers) {
      // Convert department name to ID
      const allDepartments = await firebase_get('departments')
      let senderDepartmentId = sender.department
      if (allDepartments && typeof allDepartments === 'object') {
        for (const [deptId, dept] of Object.entries(allDepartments)) {
          if (dept.name === sender.department) {
            senderDepartmentId = deptId
            break
          }
        }
      }

      // Convert department2 name to ID
      const allDepartments2 = await firebase_get('departments2')
      let senderSubDepartmentId = sender.department2
      if (allDepartments2 && typeof allDepartments2 === 'object') {
        for (const [deptId, dept] of Object.entries(allDepartments2)) {
          if (dept.name === sender.department2) {
            senderSubDepartmentId = deptId
            break
          }
        }
      }

      for (const [key, approver] of Object.entries(approvers)) {
        const isMatch = approver.departmentId === senderDepartmentId
        const subDeptMatch = !approver.subDepartmentId ? true : (approver.subDepartmentId === senderSubDepartmentId)
        const willApprove = isMatch && subDeptMatch

        if (willApprove) {
          matchedApprovers.push({
            key,
            approver: approver,
            reason: 'Matched'
          })
        } else {
          matchedApprovers.push({
            key,
            approver: approver,
            reason: `Not matched - deptMatch: ${isMatch}, subDeptMatch: ${subDeptMatch}`
          })
        }
      }
    }

    res.json({
      status: "approve-debug",
      sender: {
        userId: senderUserId,
        department: sender?.department,
        department2: sender?.department2,
        hasDepartment: !!sender?.department
      },
      approversCount: approvers ? Object.keys(approvers).length : 0,
      matchedApproversCount: matchedApprovers.length,
      approversDetail: matchedApprovers
    })
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

// Debug endpoint - ตรวจสอบ sent memos status
app.get("/debug/sent-memos/:senderUserId", async (req, res) => {
  try {
    const { senderUserId } = req.params
    const sentMemos = await firebase_get(`sent_memos/${senderUserId}`)

    let memoList = []
    if (sentMemos && typeof sentMemos === 'object') {
      for (const [memoId, memo] of Object.entries(sentMemos)) {
        memoList.push({
          memoId,
          title: memo.title,
          status: memo.status,
          requiresApproval: memo.requiresApproval,
          sentAt: memo.sentAt,
          recipientId: memo.recipientId,
          approvalPending: memo.approvalPending,
          approvers: memo.approvers
        })
      }
    }

    res.json({
      status: "sent-memos-debug",
      senderUserId,
      memoCount: memoList.length,
      memos: memoList
    })
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
})

// Log event (for client-side logging, e.g. persistent login)
app.post("/log-event", verifyToken, async (req, res) => {
  try {
    const { level = 'info', messageKey, data } = req.body

    if (!messageKey) {
      return res.status(400).json({ error: "messageKey is required" })
    }

    addLog(level, messageKey, data)
    res.json({ status: "Event logged successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
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
    const allLogs = await firebase_get("logs")

    res.json({
      status: "ok",
      logsFromFirebase: allLogs || {}
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Clear logs - ลบ logs ทั้งหมด และ Backup ใน Firebase
app.post("/clear-logs", async (req, res) => {
  try {
    // สร้าง backup object ด้วย timestamp
    const backupData = {
      backupDate: new Date().toISOString(),
      logsCount: logs.length,
      logs: logs
    }

    // บันทึก logs ลงใน logs_Backup ใน Firebase
    await firebase_set(`logs_Backup/${Date.now()}`, backupData)

    // ลบ logs จาก memory
    logs = []

    // ลบ logs จาก Firebase
    await firebase_delete("logs")

    res.json({
      status: "Logs cleared and backed up",
      backupCount: backupData.logsCount,
      backupDate: backupData.backupDate
    })
  } catch (err) {
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

// ──────────────────────────────────────────────
// R&D Project Workflow System
// ──────────────────────────────────────────────

// Set R&D Project roles (approver and engineer)
app.post("/api/rdproject/roles/set", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const { approverUserId, engineerUserId, rawMatFirstApproverId } = req.body

    // Check if at least one approver/engineer pair or a rawmat approver is provided
    if (!approverUserId && !engineerUserId && !rawMatFirstApproverId) {
      return res.status(400).json({ error: "Must provide at least one role assignment" })
    }

    // Get existing roles to preserve other settings
    const existingRoles = await firebase_get('rd_project_roles') || {}

    // Build new roles data - preserve existing values if not being updated
    const rolesData = {
      approverUserId: approverUserId || existingRoles.approverUserId || null,
      approverName: existingRoles.approverName || null,
      approverUsername: existingRoles.approverUsername || null,
      engineerUserId: engineerUserId || existingRoles.engineerUserId || null,
      engineerName: existingRoles.engineerName || null,
      engineerUsername: existingRoles.engineerUsername || null,
      rawMatApproverId: existingRoles.rawMatApproverId || null,
      rawMatApproverName: existingRoles.rawMatApproverName || null,
      rawMatApproverUsername: existingRoles.rawMatApproverUsername || null,
      rawMatFirstApproverId: rawMatFirstApproverId || existingRoles.rawMatFirstApproverId || null,
      rawMatFirstApproverName: existingRoles.rawMatFirstApproverName || null,
      rawMatFirstApproverUsername: existingRoles.rawMatFirstApproverUsername || null,
      updatedAt: new Date().toISOString(),
      updatedBy: req.userId
    }

    // Verify and fetch details for approver/engineer if provided
    if (approverUserId) {
      const approver = await firebase_get(`users/${approverUserId}`)
      if (!approver) {
        return res.status(404).json({ error: "Approver user not found" })
      }
      rolesData.approverName = `${approver.name} ${approver.surname}`
      rolesData.approverUsername = approver.username
    }

    if (engineerUserId) {
      const engineer = await firebase_get(`users/${engineerUserId}`)
      if (!engineer) {
        return res.status(404).json({ error: "Engineer user not found" })
      }
      rolesData.engineerName = `${engineer.name} ${engineer.surname}`
      rolesData.engineerUsername = engineer.username
    }

    // Verify and fetch details for raw material first approver if provided
    if (rawMatFirstApproverId) {
      const firstApprover = await firebase_get(`users/${rawMatFirstApproverId}`)
      if (!firstApprover) {
        return res.status(404).json({ error: "Raw Material First Approver user not found" })
      }
      rolesData.rawMatFirstApproverName = `${firstApprover.name} ${firstApprover.surname}`
      rolesData.rawMatFirstApproverUsername = firstApprover.username
    }



    await firebase_set('rd_project_roles', rolesData)

    res.json({ status: "Roles assigned successfully", rolesData })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get R&D Project roles
app.get("/api/rdproject/roles", verifyToken, async (req, res) => {
  try {
    const rolesData = await firebase_get('rd_project_roles')

    if (!rolesData) {
      return res.json({
        approverUserId: null,
        approverName: "Not assigned",
        approverSignatureImageUrl: null,
        engineerUserId: null,
        engineerName: "Not assigned",
        engineerSignatureImageUrl: null,
        rawMatApproverId: null,
        rawMatApproverName: "Not assigned",
        rawMatApproverSignatureImageUrl: null,
        rawMatFirstApproverId: null,
        rawMatFirstApproverName: "Not assigned",
        rawMatFirstApproverSignatureImageUrl: null
      })
    }

    // Fetch signature image URLs from user records
    let approverSignatureImageUrl = null
    let engineerSignatureImageUrl = null
    let rawMatApproverSignatureImageUrl = null
    let rawMatFirstApproverSignatureImageUrl = null

    if (rolesData.approverUserId) {
      const approverUser = await firebase_get(`users/${rolesData.approverUserId}`)
      if (approverUser) {
        approverSignatureImageUrl = approverUser.signatureImageUrl || null
      }
    }

    if (rolesData.engineerUserId) {
      const engineerUser = await firebase_get(`users/${rolesData.engineerUserId}`)
      if (engineerUser) {
        engineerSignatureImageUrl = engineerUser.signatureImageUrl || null
      }
    }

    if (rolesData.rawMatApproverId) {
      const rawMatApproverUser = await firebase_get(`users/${rolesData.rawMatApproverId}`)
      if (rawMatApproverUser) {
        rawMatApproverSignatureImageUrl = rawMatApproverUser.signatureImageUrl || null
      }
    }

    if (rolesData.rawMatFirstApproverId) {
      const rawMatFirstApproverUser = await firebase_get(`users/${rolesData.rawMatFirstApproverId}`)
      if (rawMatFirstApproverUser) {
        rawMatFirstApproverSignatureImageUrl = rawMatFirstApproverUser.signatureImageUrl || null
      }
    }

    // Return roles data with signature image URLs
    const enrichedRolesData = {
      ...rolesData,
      approverSignatureImageUrl,
      engineerSignatureImageUrl,
      rawMatApproverSignatureImageUrl,
      rawMatFirstApproverSignatureImageUrl
    }

    res.json(enrichedRolesData)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete R&D Project role
app.post("/api/rdproject/roles/delete", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    await firebase_delete('rd_project_roles')

    res.json({ status: "R&D Project roles deleted successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Set Raw Material Approver role
app.post("/api/rawmat/approver/set", verifyToken, async (req, res) => {
  try {
    const currentUser = await firebase_get(`users/${req.userId}`)
    if (!currentUser || currentUser.role !== 'admin') {
      return res.status(403).json({ error: "Admin access required" })
    }

    const { approverId } = req.body

    if (!approverId) {
      return res.status(400).json({ error: "approverId required" })
    }

    // Verify user exists
    const approver = await firebase_get(`users/${approverId}`)
    if (!approver) {
      return res.status(404).json({ error: "Approver user not found" })
    }

    // Get existing roles
    const existingRoles = await firebase_get('rd_project_roles') || {}

    // Update with rawmat approver
    const rolesData = {
      ...existingRoles,
      rawMatApproverId: approverId,
      rawMatApproverName: `${approver.name} ${approver.surname}`,
      rawMatApproverUsername: approver.username,
      updatedAt: new Date().toISOString(),
      updatedBy: req.userId
    }

    await firebase_set('rd_project_roles', rolesData)

    res.json({ status: "Raw Material Approver set successfully", rolesData })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create R&D Project (submitted by user1 - initiator)
app.post("/api/rdproject", verifyToken, async (req, res) => {
  try {
    const initiatorUserId = req.userId
    const initiatorUser = await firebase_get(`users/${initiatorUserId}`)

    if (!initiatorUser) {
      return res.status(404).json({ error: "User not found" })
    }

    // Get R&D Project roles
    const rolesData = await firebase_get('rd_project_roles')
    if (!rolesData || !rolesData.approverUserId || !rolesData.engineerUserId) {
      return res.status(400).json({ error: "R&D Project roles not configured. Please assign approver and engineer first." })
    }

    const approverUserId = rolesData.approverUserId
    const engineerUserId = rolesData.engineerUserId
    const approverName = rolesData.approverName
    const engineerName = rolesData.engineerName

    // Get approver and engineer user data for senderObject/recipientObjects
    const approverUser = await firebase_get(`users/${approverUserId}`)
    const engineerUser = await firebase_get(`users/${engineerUserId}`)

    if (!approverUser) {
      return res.status(404).json({ error: "Approver user not found" })
    }

    if (!engineerUser) {
      return res.status(404).json({ error: "Engineer user not found" })
    }

    // Extract R&D project form data from request
    const { projectNumber, projectName, division, purpose, specification, conditions, shopName,
      productSample, targetCustomer, customerAddress, monthlyQuantity, salesPrice, revenue, terms, imageUrl, imageUrls } = req.body
    
    // Support both old format (imageUrl) and new format (imageUrls)
    const finalImageUrls = imageUrls || (imageUrl ? [imageUrl] : [])

    if (!projectName) {
      return res.status(400).json({ error: "Project name is required" })
    }

    // Create memo ID for R&D project (as memo instead of separate table)
    const memoId = `rdproject_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Format content with labels
    const content = {
      'Project Number': projectNumber || '—',
      'Project Name': projectName,
      'Division': division || '—',
      'Purpose': purpose || '—',
      'Specification': specification || '—',
      'Conditions': conditions || '—',
      'Shop Name': shopName || '—',
      'Product Sample': productSample || '—',
      'Target Customer': targetCustomer || '—',
      'Customer Address': customerAddress || '—',
      'Monthly Quantity': monthlyQuantity || '—',
      'Unit Sale Price': salesPrice || '—',
      'Monthly Sales Revenue': revenue || '—',
      'Purchase Sale Terms': terms || '—'
    }

    // Create memo record for sent_memos
    const sentMemoData = {
      memoId,
      type: 'R&D Project',
      title: `R&D Project: ${projectName}`,
      content: content,
      projectId: memoId,
      stage: 'marketing_pending',
      senderId: initiatorUserId,
      senderName: `${initiatorUser.name} ${initiatorUser.surname}`,
      senderUserId: initiatorUserId,
      senderObject: {
        userId: initiatorUserId,
        name: initiatorUser.name,
        surname: initiatorUser.surname,
        username: initiatorUser.username,
        department: initiatorUser.department,
        department2: initiatorUser.department2
      },
      recipientId: approverUserId,
      recipientName: `${approverUser.name} ${approverUser.surname}`,
      recipientIds: [approverUserId],
      recipientObjects: [{
        systemUserId: approverUserId,
        name: `${approverUser.name} ${approverUser.surname}`,
        department: approverUser.department,
        department2: approverUser.department2
      }],
      sentAt: new Date().toISOString(),
      status: 'pending_approval',
      docNumber: projectNumber || '',
      isRDProject: true,
      approvalType: 'marketing',
      imageUrls: finalImageUrls && finalImageUrls.length > 0 ? finalImageUrls : null
    }

    await firebase_set(`sent_memos/${initiatorUserId}/${memoId}`, sentMemoData)

    // Create memo record for received_memos (for approver)
    const receivedMemoData = {
      memoId,
      type: 'R&D Project',
      title: `R&D Project: ${projectName}`,
      content: content,
      projectId: memoId,
      stage: 'marketing_pending',
      senderId: initiatorUserId,
      senderName: `${initiatorUser.name} ${initiatorUser.surname}`,
      senderUserId: initiatorUserId,
      senderObject: {
        userId: initiatorUserId,
        name: initiatorUser.name,
        surname: initiatorUser.surname,
        username: initiatorUser.username,
        department: initiatorUser.department,
        department2: initiatorUser.department2
      },
      recipientId: approverUserId,
      recipientName: `${approverUser.name} ${approverUser.surname}`,
      recipientIds: [approverUserId],
      recipientObjects: [{
        systemUserId: approverUserId,
        name: `${approverUser.name} ${approverUser.surname}`,
        department: approverUser.department,
        department2: approverUser.department2
      }],
      sentAt: new Date().toISOString(),
      status: 'pending_approval',
      docNumber: projectNumber || '',
      isRDProject: true,
      approvalType: 'marketing',
      imageUrls: finalImageUrls && finalImageUrls.length > 0 ? finalImageUrls : null
    }

    await firebase_set(`received_memos/${approverUserId}/${memoId}`, receivedMemoData)

    // Create notification for approver
    const notification = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      title: 'R&D Project Awaiting Review',
      message: `New R&D project "${projectName}" from ${initiatorUser.name} ${initiatorUser.surname} awaits your marketing review`,
      type: 'rdproject_pending_approval',
      read: false,
      timestamp: new Date().toISOString(),
      memoId,
      stage: 'marketing_pending',
      senderId: initiatorUserId,
      senderName: `${initiatorUser.name} ${initiatorUser.surname}`
    }

    await firebase_set(`notifications/${approverUserId}/${notification.id}`, notification)

    // Send LINE message to approver if they have linked followers
    try {
      const approverUser = await firebase_get(`users/${approverUserId}`)
      if (approverUser && approverUser.linkedFollowers) {
        const approverFollowerIds = Object.keys(approverUser.linkedFollowers)

        if (approverFollowerIds.length > 0) {
          const lineMessage = {
            type: "flex",
            altText: `R&D Project Awaiting Approval: ${projectName}`,
            contents: {
              type: "bubble",
              header: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "text",
                    text: "R&D Project Review",
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
                    text: projectName,
                    weight: "bold",
                    size: "lg",
                    wrap: true,
                    color: "#182034"
                  },
                  {
                    type: "text",
                    text: `From: ${initiatorUser.name} ${initiatorUser.surname}`,
                    size: "sm",
                    color: "#c8a96e",
                    weight: "bold",
                    margin: "md"
                  },
                  {
                    type: "text",
                    text: `Status: ⏳ Awaiting Your Review`,
                    size: "sm",
                    color: "#1a2740",
                    weight: "bold",
                    margin: "md"
                  },
                  ...(projectNumber ? [{
                    type: "text",
                    text: `Project No.: ${projectNumber}`,
                    size: "sm",
                    color: "#1a2740",
                    weight: "bold",
                    margin: "md"
                  }] : []),
                  {
                    type: "separator",
                    margin: "md"
                  },
                  {
                    type: "text",
                    text: `Stage: Marketing Review\n\nPlease review project information and approve or reject.`,
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
                      label: "Review Project",
                      uri: "https://rmcmemorandum.onrender.com/"
                    },
                    style: "primary",
                    color: "#1a2740"
                  }
                ]
              }
            }
          }

          for (const followerId of approverFollowerIds) {
            try {
              await client.pushMessage(followerId, lineMessage)
            } catch (lineErr) {
              // Silent error
            }
          }
        }
      }
    } catch (lineErr) {
      // Silent error - LINE notification not critical
    }

    addLog('info', 'create_rdproject', {
      memoId,
      projectName,
      initiatorId: initiatorUserId,
      initiatorName: `${initiatorUser.name} ${initiatorUser.surname}`,
      docNumber: projectNumber || '',
      stage: 'marketing_pending'
    })

    res.json({
      status: "R&D Project created successfully",
      memoId,
      stage: 'marketing_pending',
      message: `Project submitted to ${approverName} for marketing review`
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── RAW MATERIAL REQUEST ENDPOINT ──
app.post("/api/rawmat", verifyToken, async (req, res) => {
  try {
    const initiatorUserId = req.userId
    const initiatorUser = await firebase_get(`users/${initiatorUserId}`)

    if (!initiatorUser) {
      return res.status(404).json({ error: "User not found" })
    }

    // Extract data from request (approvers are now from admin config, not request body)
    const { documentNo, projectName, purpose, supplierName, supplierContact,
      materialName, quantity, lot, price, moq, description, imageUrl, imageUrls } = req.body
    
    // Support both old format (imageUrl) and new format (imageUrls)
    const finalImageUrls = imageUrls || (imageUrl ? [imageUrl] : [])

    if (!projectName || !supplierName || !materialName) {
      return res.status(400).json({ error: "Project name, supplier name, and material name are required" })
    }

    // Get admin-configured roles from rd_project_roles
    const rolesData = await firebase_get('rd_project_roles')

    // Extract first and second approvers from admin config
    const firstApproverId = rolesData?.rawMatFirstApproverId
    const secondApproverId = rolesData?.rawMatApproverId  // rawMatApproverId is the second approver
    const engineerId = rolesData?.engineerUserId
    const engineerName = rolesData?.engineerName

    // Validate that both approvers are configured
    if (!firstApproverId) {
      return res.status(400).json({ error: "Raw Material First Approver is not assigned. Please configure in admin settings." })
    }

    if (!secondApproverId) {
      return res.status(400).json({ error: "Raw Material Approver (second approval) is not assigned. Please configure in admin settings." })
    }

    if (!engineerId) {
      return res.status(400).json({ error: "R&D Engineer is not assigned. Please configure engineer first." })
    }

    // Validate that first and second approvers are different
    if (firstApproverId === secondApproverId) {
      return res.status(400).json({ error: "First and second approvers must be different" })
    }

    // Fetch and validate first approver user
    const firstApproverUser = await firebase_get(`users/${firstApproverId}`)
    if (!firstApproverUser) {
      return res.status(404).json({ error: "First approver user not found in system" })
    }

    // Fetch and validate second approver user
    const secondApproverUser = await firebase_get(`users/${secondApproverId}`)
    if (!secondApproverUser) {
      return res.status(404).json({ error: "Second approver user not found in system" })
    }

    // Fetch and validate engineer user
    const engineerUser = await firebase_get(`users/${engineerId}`)
    if (!engineerUser) {
      return res.status(404).json({ error: "Engineer user not found" })
    }

    // Build names
    const firstApproverName = `${firstApproverUser.name} ${firstApproverUser.surname || ''}`.trim()
    const secondApproverName = `${secondApproverUser.name} ${secondApproverUser.surname || ''}`.trim()
    const senderName = `${initiatorUser.name} ${initiatorUser.surname || ''}`.trim()
    const currentDate = new Date().toISOString()

    // Create memo ID for raw material request
    const memoId = `rawmat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Build engineer recipient info
    const engineerRecipient = {
      userId: engineerId,
      systemUserId: engineerId,
      name: engineerName,
      department: engineerUser.department || '—'
    }

    // Format content with labels (Thai labels for display)
    const content = {
      'Document No': documentNo || '—',
      'Date': new Date(currentDate).toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      'Project Name': projectName,
      'Purpose': purpose || '—',
      'Supplier Name': supplierName || '—',
      'Supplier Contact': supplierContact || '—',
      'Material Name': materialName || '—',
      'Quantity': quantity || '—',
      'Lot': lot || '—',
      'Price': price || '—',
      'MOQ': moq || '—',
      'Description': description || '—'
    }

    // Create memo record for sent_memos with two-approver flow
    const sentMemoData = {
      memoId,
      type: 'Raw Material Request',
      title: `Raw Material Request: ${materialName}`,
      content: content,
      isRawMaterialRequest: true,
      senderId: initiatorUserId,
      senderUserId: initiatorUserId,
      senderName: senderName,
      senderDepartment: initiatorUser.department || '—',
      timestamp: currentDate,
      date: currentDate,
      sentAt: currentDate,
      documentNo: documentNo,
      projectName: projectName,
      materialName: materialName,
      status: 'pending_approval',
      approverRequired: true,
      firstApproverId: firstApproverId,
      firstApproverName: firstApproverName,
      secondApproverId: secondApproverId,
      secondApproverName: secondApproverName,
      recipients: [engineerId],
      recipientNames: [engineerName],
      recipientObjects: [engineerRecipient],
      imageUrls: finalImageUrls && finalImageUrls.length > 0 ? finalImageUrls : null
    }

    // Store in sent_memos for initiator
    await firebase_set(`sent_memos/${initiatorUserId}/${memoId}`, sentMemoData)

    // ─── Send to First Approver ───────────
    const firstApproverMemoData = {
      ...sentMemoData,
      receivedBy: firstApproverId,
      isRead: false,
      acknowledged: false,
      acknowledgedAt: null,
      approvalStage: 'first_approval'
    }

    await firebase_set(`received_memos/${firstApproverId}/${memoId}`, firstApproverMemoData)

    // Create notification for first approver
    const firstApproverNotificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const firstApproverNotification = {
      id: firstApproverNotificationId,
      type: 'raw_material_request_approval',
      title: `Raw Material Request from ${senderName}`,
      message: `Raw material request for: ${materialName} (Step 1/2 - First approval)`,
      timestamp: currentDate,
      memoId: memoId,
      isRead: false,
      fromUser: senderName,
      documentNo: documentNo,
      status: 'pending',
      approvalStage: 'first_approval',
      navigateTo: 'pending-approvals',
      memoObject: firstApproverMemoData
    }

    await firebase_set(`notifications/${firstApproverId}/${firstApproverNotificationId}`, firstApproverNotification)

    // Send LINE notification to first approver
    try {
      if (firstApproverUser.linkedFollowers && Object.keys(firstApproverUser.linkedFollowers).length > 0 && client) {
        const firstApproverFollowerIds = Object.keys(firstApproverUser.linkedFollowers)
        console.log(`[RAWMAT] Sending first approver notification to ${firstApproverFollowerIds.length} follower(s)`)

        for (const followerId of firstApproverFollowerIds) {
          try {
            const firstApprovalLineMessage = {
              type: "flex",
              altText: `Raw Material Request - First Approval: ${materialName}`,
              contents: {
                type: "bubble",
                header: {
                  type: "box",
                  layout: "vertical",
                  contents: [
                    {
                      type: "text",
                      text: "Approval Required",
                      weight: "bold",
                      color: "#c9a84c",
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
                      text: materialName,
                      weight: "bold",
                      size: "lg",
                      wrap: true,
                      color: "#1e2c4e"
                    },
                    {
                      type: "text",
                      text: `From: ${senderName}`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    },
                    ...(documentNo ? [{
                      type: "text",
                      text: `Doc No.: ${documentNo}`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    }] : []),
                    {
                      type: "text",
                      text: `Project: ${projectName}`,
                      size: "sm",
                      color: "#1e2c4e",
                      weight: "bold",
                      margin: "md"
                    },
                    {
                      type: "text",
                      text: `Status: Waiting for your approval`,
                      size: "sm",
                      color: "#c9a84c",
                      weight: "bold",
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
                        label: "Review & Approve",
                        uri: "https://rmcmemorandum.onrender.com/"
                      },
                      style: "primary",
                      color: "#1e2c4e"
                    }
                  ]
                }
              }
            }
            await client.pushMessage(followerId, firstApprovalLineMessage)
          } catch (lineErr) {
            console.error(`Error sending first approval LINE notification to follower ${followerId}:`, lineErr)
          }
        }
      }
    } catch (lineErr) {
      console.error('Error sending first approval LINE notifications:', lineErr)
    }

    // ─── Second Approver will receive memo AFTER first approver approves ───────────
    // (No memo/notification sent to second approver yet - they will get it after first approval)
    // Create a "blocked" placeholder to track the request status
    const secondApproverMemoData = {
      ...sentMemoData,
      receivedBy: secondApproverId,
      isRead: false,
      acknowledged: false,
      acknowledgedAt: null,
      approvalStage: 'second_approval',
      approvalBlocked: true,
      blockReason: 'Awaiting first approval'
    }

    // Store blocked memo so second approver can see it's pending (but cannot act on it)
    await firebase_set(`received_memos/${secondApproverId}/${memoId}`, secondApproverMemoData)

    // Send acknowledgment to initiator (request submitted, waiting for approval)
    try {
      const initiatorNotificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const initiatorNotification = {
        id: initiatorNotificationId,
        type: 'raw_material_request_submitted',
        title: `Raw Material Request Submitted: ${materialName}`,
        message: `Submitted - Awaiting approval from ${firstApproverName} (Step 1/2)`,
        timestamp: currentDate,
        memoId: memoId,
        isRead: false,
        documentNo: documentNo,
        status: 'pending_approval',
        navigateTo: 'dashboard',
        memoObject: sentMemoData
      }

      await firebase_set(`notifications/${initiatorUserId}/${initiatorNotificationId}`, initiatorNotification)

      // Send LINE notification to initiator
      try {
        if (initiatorUser.linkedFollowers && Object.keys(initiatorUser.linkedFollowers).length > 0 && client) {
          const initiatorFollowerIds = Object.keys(initiatorUser.linkedFollowers)

          for (const followerId of initiatorFollowerIds) {
            try {
              const initiatorLineMessage = {
                type: "flex",
                altText: `Raw Material Request Submitted: ${materialName}`,
                contents: {
                  type: "bubble",
                  header: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "text",
                        text: "Request Submitted",
                        weight: "bold",
                        color: "#1e2c4e",
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
                        text: materialName,
                        weight: "bold",
                        size: "lg",
                        wrap: true,
                        color: "#1e2c4e"
                      },
                      {
                        type: "text",
                        text: `Doc No.: ${documentNo}`,
                        size: "sm",
                        color: "#1e2c4e",
                        weight: "bold",
                        margin: "md"
                      },
                      {
                        type: "text",
                        text: `Project: ${projectName}`,
                        size: "sm",
                        color: "#1e2c4e",
                        weight: "bold",
                        margin: "md"
                      },
                      {
                        type: "text",
                        text: `Awaiting approval from: ${rawMatApproverName}`,
                        size: "sm",
                        color: "#c9a84c",
                        weight: "bold",
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
                          uri: "https://rmcmemorandum.onrender.com/"
                        },
                        style: "primary",
                        color: "#1e2c4e"
                      }
                    ]
                  }
                }
              }
              await client.pushMessage(followerId, initiatorLineMessage)
            } catch (lineErr) {
              console.error(`Error sending initiator LINE notification to follower ${followerId}:`, lineErr)
            }
          }
        }
      } catch (lineErr) {
        console.error('Error sending initiator LINE notifications:', lineErr)
      }
    } catch (err) {
      console.error('Error sending initiator notification:', err)
    }

    res.json({
      status: "Raw material request submitted for approval",
      memoId,
      documentNo,
      senderName: senderName,
      firstApproverId: firstApproverId,
      firstApproverName: firstApproverName,
      secondApproverId: secondApproverId,
      secondApproverName: secondApproverName,
      message: `Raw material request for ${materialName} has been submitted to ${firstApproverName} for first approval`
    })

    // Log success
    addLog('info', 'rawmat_memo_submitted_for_approval', {
      memoId,
      documentNo,
      initiatorUserId,
      initiatorName: `${initiatorUser.name} ${initiatorUser.surname}`,
      firstApproverId: firstApproverId,
      firstApproverName: firstApproverName,
      secondApproverId: secondApproverId,
      secondApproverName: secondApproverName,
      projectName,
      materialName
    })
  } catch (err) {
    addLog('error', 'rawmat_memo_submission_failed', {
      error: err.message,
      initiatorUserId: req.userId,
      stack: err.stack
    })
    res.status(500).json({ error: err.message })
  }
})

// Approve Raw Material Request (approver sends to engineer)
app.post("/api/rawmat/:memoId/approve", verifyToken, async (req, res) => {
  try {
    const memoId = req.params.memoId
    const approverId = req.userId
    const approverUser = await firebase_get(`users/${approverId}`)

    if (!approverUser) {
      return res.status(404).json({ error: "Approver user not found" })
    }

    // Get the memo from the approver's received_memos
    const memo = await firebase_get(`received_memos/${approverId}/${memoId}`)

    if (!memo) {
      return res.status(404).json({ error: "Raw material memo not found in your received memos" })
    }

    if (memo.status !== 'pending_approval') {
      return res.status(400).json({ error: "Memo is not pending approval" })
    }

    // Check if this is a two-stage approval and validate the approver
    const approvalStage = memo.approvalStage
    const isAdmin = approverUser.role === 'admin'

    if (approvalStage === 'first_approval') {
      // First approval - must be firstApproverId or admin
      if (memo.firstApproverId !== approverId && !isAdmin) {
        return res.status(403).json({ error: "Only the first approver can approve this stage" })
      }
    } else if (approvalStage === 'second_approval') {
      // Second approval - must be secondApproverId or admin
      if (memo.secondApproverId !== approverId && !isAdmin) {
        return res.status(403).json({ error: "Only the second approver can approve this stage" })
      }
    } else {
      // Fallback for older memos without approvalStage
      if (memo.firstApproverId === approverId) {
        // This is a first approval
      } else if (memo.secondApproverId === approverId) {
        // This is a second approval
      } else if (!isAdmin) {
        // Not admin and not an assigned approver
        return res.status(403).json({ error: "You are not an assigned approver for this memo" })
      }
    }

    const senderUserId = memo.senderId

    // Get second approver info for responses
    const secondApproverUser = await firebase_get(`users/${memo.secondApproverId}`)
    const secondApproverName = secondApproverUser ? `${secondApproverUser.name} ${secondApproverUser.surname || ''}`.trim() : 'Unknown'

    // Get engineer from roles
    const rolesData = await firebase_get('rd_project_roles')
    const engineerId = rolesData?.engineerUserId
    const engineerName = rolesData?.engineerName

    if (!engineerId) {
      return res.status(400).json({ error: "R&D Engineer is not assigned" })
    }

    const engineerUser = await firebase_get(`users/${engineerId}`)
    if (!engineerUser) {
      return res.status(404).json({ error: "Engineer user not found" })
    }

    const currentDate = new Date().toISOString()

    // Build engineer recipient info
    const engineerRecipient = {
      userId: engineerId,
      systemUserId: engineerId,
      name: engineerName,
      department: engineerUser.department || '—'
    }

    // Handle approval based on stage
    if (approvalStage === 'first_approval') {
      // First approval complete - move to second approver
      const updatedMemoForSecond = {
        ...memo,
        status: 'pending_approval',
        approvalStage: 'second_approval',
        firstApprovalAt: currentDate,
        firstApprovedBy: approverId,
        firstApprovedByName: `${approverUser.name} ${approverUser.surname}`,
        approvalBlocked: false  // Unblock second approver
      }

      // Update in sender's sent_memos
      if (senderUserId) {
        await firebase_set(`sent_memos/${senderUserId}/${memoId}`, updatedMemoForSecond)
      }

      // Update in first approver's received_memos to show awaiting second approval (not pending first anymore)
      await firebase_set(`received_memos/${approverId}/${memoId}`, {
        ...updatedMemoForSecond,
        receivedBy: approverId,
        status: 'awaiting_second_approval',  // Different status so not shown in pending_approval tab
        approvalStage: 'first_approval'  // Mark as completed first stage for reference
      })

      // Send to second approver
      const secondApproverMemoData = {
        ...updatedMemoForSecond,
        receivedBy: memo.secondApproverId,
        isRead: false,
        acknowledged: false,
        acknowledgedAt: null,
        status: 'pending_approval',
        approvalStage: 'second_approval',
        approvalBlocked: false
      }

      await firebase_set(`received_memos/${memo.secondApproverId}/${memoId}`, secondApproverMemoData)

      // Create notification for second approver
      const secondApproverNotificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const secondApproverNotification = {
        id: secondApproverNotificationId,
        type: 'raw_material_request_approval',
        title: `Raw Material Request from ${memo.senderName}`,
        message: `Raw material request for: ${memo.materialName} (Step 2/2)`,
        timestamp: currentDate,
        memoId: memoId,
        isRead: false,
        fromUser: memo.senderName,
        documentNo: memo.documentNo,
        status: 'pending',
        approvalStage: 'second_approval',
        navigateTo: 'pending-approvals',
        memoObject: secondApproverMemoData
      }

      await firebase_set(`notifications/${memo.secondApproverId}/${secondApproverNotificationId}`, secondApproverNotification)

      // Send LINE notification to second approver
      try {
        const secondApproverUser = await firebase_get(`users/${memo.secondApproverId}`)
        if (secondApproverUser && secondApproverUser.linkedFollowers && Object.keys(secondApproverUser.linkedFollowers).length > 0 && client) {
          const secondApproverFollowerIds = Object.keys(secondApproverUser.linkedFollowers)
          console.log(`[RAWMAT] Notifying second approver of first approval completion`)

          for (const followerId of secondApproverFollowerIds) {
            try {
              const secondApprovalLineMessage = {
                type: "flex",
                altText: `Raw Material Request - Ready for Second Approval: ${memo.materialName}`,
                contents: {
                  type: "bubble",
                  header: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "text",
                        text: "Approval Required",
                        weight: "bold",
                        color: "#c9a84c",
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
                        text: memo.materialName,
                        weight: "bold",
                        size: "lg",
                        wrap: true,
                        color: "#1e2c4e"
                      },
                      {
                        type: "text",
                        text: `From: ${memo.senderName}`,
                        size: "sm",
                        color: "#1e2c4e",
                        weight: "bold",
                        margin: "md"
                      },
                      // ✨ เพิ่ม docNo
                      ...(memo.documentNo ? [{
                        type: "text",
                        text: `Doc No.: ${memo.documentNo}`,
                        size: "sm",
                        color: "#1e2c4e",
                        weight: "bold",
                        margin: "md"
                      }] : []),
                      {
                        type: "text",
                        text: `Project: ${memo.projectName}`,
                        size: "sm",
                        color: "#1e2c4e",
                        weight: "bold",
                        margin: "md"
                      },
                      {
                        type: "text",
                        text: `First Approval: ${approverUser.name}`,
                        size: "sm",
                        color: "#2e8b57",
                        weight: "bold",
                        margin: "md"
                      },
                      // ✨ เพิ่ม Status
                      {
                        type: "text",
                        text: `Status: Waiting for your approval`,
                        size: "sm",
                        color: "#c9a84c",
                        weight: "bold",
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
                          label: "Review & Approve",
                          uri: "https://rmcmemorandum.onrender.com/"
                        },
                        style: "primary",
                        color: "#1e2c4e"
                      }
                    ]
                  }
                }
              }
              await client.pushMessage(followerId, secondApprovalLineMessage)
            } catch (lineErr) {
              console.error(`Error sending second approval notification to follower ${followerId}:`, lineErr)
            }
          }
        }
      } catch (lineErr) {
        console.error('Error sending second approval LINE notification:', lineErr)
      }

      // First approval complete - respond to first approver
      return res.json({
        status: "First approval completed. Request moved to second approver.",
        memoId,
        approvalStage: 'first_approval',
        nextApprover: secondApproverName,
        firstApprovedByName: `${approverUser.name} ${approverUser.surname}`,
        firstApprovalAt: currentDate
      })

    } else if (approvalStage === 'second_approval') {
      // Second approval complete - send to engineer
      const approvedMemoData = {
        ...memo,
        status: 'acknowledged',
        secondApprovalAt: currentDate,
        secondApprovedBy: approverId,
        secondApprovedByName: `${approverUser.name} ${approverUser.surname}`,
        sentToEngineer: true,
        engineerId: engineerId,
        engineerName: engineerName,
        recipients: [engineerId],
        recipientNames: [engineerName],
        recipientObjects: [engineerRecipient]
      }

      // Update in sent_memos for original sender
      if (senderUserId) {
        await firebase_set(`sent_memos/${senderUserId}/${memoId}`, approvedMemoData)
      }

      // Update in second approver's received_memos to show it's been approved
      await firebase_set(`received_memos/${approverId}/${memoId}`, {
        ...approvedMemoData,
        receivedBy: approverId,
        status: 'approved'
      })

      // IMPORTANT: Also update first approver's received_memos to show approval is complete
      if (memo.firstApproverId) {
        await firebase_set(`received_memos/${memo.firstApproverId}/${memoId}`, {
          ...approvedMemoData,
          receivedBy: memo.firstApproverId,
          status: 'approved'
        })
      }

      // Send memo to engineer
      const engineerMemoData = {
        ...approvedMemoData,
        receivedBy: engineerId,
        isRead: false,
        acknowledged: false,
        acknowledgedAt: null
      }

      await firebase_set(`received_memos/${engineerId}/${memoId}`, engineerMemoData)

      // Create notification for engineer
      const engineerNotificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const engineerNotification = {
        id: engineerNotificationId,
        type: 'raw_material_request',
        title: `Raw Material Request: ${memo.materialName}`,
        message: `Raw material request from ${memo.senderName} (approved by ${approverUser.name})`,
        timestamp: currentDate,
        memoId: memoId,
        isRead: false,
        fromUser: memo.senderName,
        documentNo: memo.documentNo,
        status: 'approved',
        approverName: `${approverUser.name} ${approverUser.surname}`
      }

      await firebase_set(`notifications/${engineerId}/${engineerNotificationId}`, engineerNotification)

      // Send LINE notification to engineer
      try {
        if (engineerUser.linkedFollowers && Object.keys(engineerUser.linkedFollowers).length > 0 && client) {
          const engineerFollowerIds = Object.keys(engineerUser.linkedFollowers)

          for (const followerId of engineerFollowerIds) {
            try {
              const engineerLineMessage = {
                type: "flex",
                altText: `Raw Material Request: ${memo.materialName}`,
                contents: {
                  type: "bubble",
                  header: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "text",
                        text: "✓ Raw Material Request",
                        weight: "bold",
                        color: "#2e8b57",
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
                        text: memo.materialName,
                        weight: "bold",
                        size: "lg",
                        wrap: true,
                        color: "#1e2c4e"
                      },
                      {
                        type: "text",
                        text: `From: ${memo.senderName}`,
                        size: "sm",
                        color: "#1e2c4e",
                        weight: "bold",
                        margin: "md"
                      },
                      ...(memo.documentNo ? [{
                        type: "text",
                        text: `Doc No.: ${memo.documentNo}`,
                        size: "sm",
                        color: "#1e2c4e",
                        weight: "bold",
                        margin: "md"
                      }] : []),
                      {
                        type: "text",
                        text: `Project: ${memo.projectName}`,
                        size: "sm",
                        color: "#1e2c4e",
                        weight: "bold",
                        margin: "md"
                      },
                      {
                        type: "text",
                        text: `Approved by: ${approverUser.name}`,
                        size: "sm",
                        color: "#2e8b57",
                        weight: "bold",
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
                          uri: "https://rmcmemorandum.onrender.com/"
                        },
                        style: "primary",
                        color: "#1e2c4e"
                      }
                    ]
                  }
                }
              }
              await client.pushMessage(followerId, engineerLineMessage)
            } catch (lineErr) {
              console.error(`Error sending LINE notification to engineer follower ${followerId}:`, lineErr)
            }
          }
        }
      } catch (lineErr) {
        console.error('Error sending engineer LINE notifications:', lineErr)
      }

      // Send notification to sender about approval
      try {
        const senderNotificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        const senderNotification = {
          id: senderNotificationId,
          type: 'raw_material_request_approved',
          title: `Raw Material Request Approved: ${memo.materialName}`,
          message: `Your raw material request (${memo.documentNo}) has been approved and sent to ${engineerName}`,
          timestamp: currentDate,
          memoId: memoId,
          isRead: false,
          documentNo: memo.documentNo,
          status: 'approved',
          navigateTo: 'dashboard',
          memoObject: memo
        }

        if (senderUserId) {
          await firebase_set(`notifications/${senderUserId}/${senderNotificationId}`, senderNotification)
        }

        // Send LINE notification to sender
        if (senderUserId) {
          try {
            const senderUser = await firebase_get(`users/${senderUserId}`)
            if (senderUser && senderUser.linkedFollowers && Object.keys(senderUser.linkedFollowers).length > 0 && client) {
              const senderFollowerIds = Object.keys(senderUser.linkedFollowers)

              for (const followerId of senderFollowerIds) {
                try {
                  const senderLineMessage = {
                    type: "flex",
                    altText: `Raw Material Request Approved: ${memo.materialName}`,
                    contents: {
                      type: "bubble",
                      header: {
                        type: "box",
                        layout: "vertical",
                        contents: [
                          {
                            type: "text",
                            text: "✓ Request Approved",
                            weight: "bold",
                            color: "#2e8b57",
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
                            text: memo.materialName,
                            weight: "bold",
                            size: "lg",
                            wrap: true,
                            color: "#1e2c4e"
                          },
                          {
                            type: "text",
                            text: `Doc No.: ${memo.documentNo}`,
                            size: "sm",
                            color: "#1e2c4e",
                            weight: "bold",
                            margin: "md"
                          },
                          {
                            type: "text",
                            text: `Project: ${memo.projectName}`,
                            size: "sm",
                            color: "#1e2c4e",
                            weight: "bold",
                            margin: "md"
                          },
                          {
                            type: "text",
                            text: `Approved by: ${approverUser.name}`,
                            size: "sm",
                            color: "#2e8b57",
                            weight: "bold",
                            margin: "md"
                          },
                          {
                            type: "text",
                            text: `Sent to: ${engineerName}`,
                            size: "sm",
                            color: "#2e6da4",
                            weight: "bold",
                            margin: "md"
                          },
                          {
                            type: "separator",
                            margin: "md"
                          },
                          {
                            type: "text",
                            text: `Status: Approved`,
                            size: "sm",
                            color: "#2e8b57",
                            weight: "bold",
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
                              uri: "https://rmcmemorandum.onrender.com/"
                            },
                            style: "primary",
                            color: "#1e2c4e"
                          }
                        ]
                      }
                    }
                  }
                  await client.pushMessage(followerId, senderLineMessage)
                } catch (lineErr) {
                  console.error(`Error sending approval LINE notification to sender follower ${followerId}:`, lineErr)
                }
              }
            }
          } catch (lineErr) {
            console.error('Error sending sender LINE notifications:', lineErr)
          }
        }
      } catch (err) {
        console.error('Error sending sender notification:', err)
      }

      addLog('info', 'rawmat_memo_approved', {
        memoId,
        approverId,
        approverName: `${approverUser.name} ${approverUser.surname}`,
        engineerId,
        engineerName,
        materialName: memo.materialName
      })

      // Second approval complete - respond to second approver
      return res.json({
        status: "Raw material request approved and sent to engineer",
        memoId,
        engineerId,
        engineerName,
        secondApprovedByName: `${approverUser.name} ${approverUser.surname}`,
        secondApprovalAt: currentDate,
        message: `Request has been sent to ${engineerName}`
      })

    } else {
      // Invalid approval stage
      return res.status(400).json({ error: `Invalid or missing approval stage: ${approvalStage}` })
    }

  } catch (err) {
    addLog('error', 'rawmat_approval_failed', {
      error: err.message,
      approverId: req.userId,
      memoId: req.params.memoId,
      stack: err.stack
    })
    return res.status(500).json({ error: err.message })
  }
})

// Reject Raw Material Request (approver rejects request)
app.post("/api/rawmat/:memoId/reject", verifyToken, async (req, res) => {
  try {
    const memoId = req.params.memoId
    const approverId = req.userId
    const { reason } = req.body

    const approverUser = await firebase_get(`users/${approverId}`)
    if (!approverUser) {
      return res.status(404).json({ error: "Approver user not found" })
    }

    // Get the memo from received_memos
    let memo = null
    let senderUserId = null

    const notifRef = await firebase_get('received_memos')
    if (notifRef) {
      for (const userId in notifRef) {
        if (notifRef[userId] && notifRef[userId][memoId]) {
          memo = notifRef[userId][memoId]
          senderUserId = memo.senderId
          break
        }
      }
    }

    if (!memo) {
      return res.status(404).json({ error: "Raw material memo not found" })
    }

    if (memo.status !== 'pending_approval') {
      return res.status(400).json({ error: "Memo is not pending approval" })
    }

    if (memo.approverId !== approverId) {
      return res.status(403).json({ error: "Only the assigned approver can reject this memo" })
    }

    const currentDate = new Date().toISOString()

    // Update memo status to rejected
    const rejectedMemoData = {
      ...memo,
      status: 'rejected',
      rejectedAt: currentDate,
      rejectedBy: approverId,
      rejectedByName: `${approverUser.name} ${approverUser.surname}`,
      rejectionReason: reason || 'No reason provided'
    }

    // Update in sent_memos
    if (senderUserId) {
      await firebase_set(`sent_memos/${senderUserId}/${memoId}`, rejectedMemoData)
    }

    // Update in approver's received_memos
    await firebase_set(`received_memos/${approverId}/${memoId}`, rejectedMemoData)

    // Send notification to sender
    try {
      const senderNotificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const senderNotification = {
        id: senderNotificationId,
        type: 'raw_material_request_rejected',
        title: `Raw Material Request Rejected: ${memo.materialName}`,
        message: `Your raw material request (${memo.documentNo}) has been rejected`,
        timestamp: currentDate,
        memoId: memoId,
        isRead: false,
        documentNo: memo.documentNo,
        status: 'rejected',
        reason: reason
      }

      if (senderUserId) {
        await firebase_set(`notifications/${senderUserId}/${senderNotificationId}`, senderNotification)
      }

      // Send LINE notification to sender
      if (senderUserId) {
        try {
          const senderUser = await firebase_get(`users/${senderUserId}`)
          if (senderUser && senderUser.linkedFollowers && Object.keys(senderUser.linkedFollowers).length > 0 && client) {
            const senderFollowerIds = Object.keys(senderUser.linkedFollowers)

            for (const followerId of senderFollowerIds) {
              try {
                const rejectionLineMessage = {
                  type: "flex",
                  altText: `Raw Material Request Rejected: ${memo.materialName}`,
                  contents: {
                    type: "bubble",
                    header: {
                      type: "box",
                      layout: "vertical",
                      contents: [
                        {
                          type: "text",
                          text: "✗ Request Rejected",
                          weight: "bold",
                          color: "#c0392b",
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
                          text: memo.materialName,
                          weight: "bold",
                          size: "lg",
                          wrap: true,
                          color: "#1e2c4e"
                        },
                        {
                          type: "text",
                          text: `Doc No.: ${memo.documentNo}`,
                          size: "sm",
                          color: "#1e2c4e",
                          weight: "bold",
                          margin: "md"
                        },
                        {
                          type: "text",
                          text: `Rejected by: ${approverUser.name}`,
                          size: "sm",
                          color: "#c0392b",
                          weight: "bold",
                          margin: "md"
                        },
                        ...(reason ? [{
                          type: "text",
                          text: `Reason: ${reason}`,
                          size: "sm",
                          color: "#7b1a1a",
                          wrap: true,
                          margin: "md"
                        }] : [])
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
                            uri: "https://rmcmemorandum.onrender.com/"
                          },
                          style: "primary",
                          color: "#1e2c4e"
                        }
                      ]
                    }
                  }
                }
                await client.pushMessage(followerId, rejectionLineMessage)
              } catch (lineErr) {
                console.error(`Error sending rejection LINE notification to sender follower ${followerId}:`, lineErr)
              }
            }
          }
        } catch (lineErr) {
          console.error('Error sending sender rejection LINE notifications:', lineErr)
        }
      }
    } catch (err) {
      console.error('Error sending sender notification:', err)
    }

    res.json({
      status: "Raw material request rejected",
      memoId,
      message: `Request has been rejected${reason ? ` with reason: ${reason}` : ''}`
    })

    addLog('info', 'rawmat_memo_rejected', {
      memoId,
      approverId,
      approverName: `${approverUser.name} ${approverUser.surname}`,
      materialName: memo.materialName,
      reason
    })
  } catch (err) {
    addLog('error', 'rawmat_rejection_failed', {
      error: err.message,
      approverId: req.userId,
      memoId: req.params.memoId,
      stack: err.stack
    })
    res.status(500).json({ error: err.message })
  }
})

// Approve R&D Project (multi-stage approval workflow)
app.post("/api/rdproject/:projectId/approve", verifyToken, async (req, res) => {
  try {
    const approverId = req.userId
    const approverUser = await firebase_get(`users/${approverId}`)
    const memoId = req.params.projectId  // This is actually the memoId with rdproject_ prefix
    const { action, notes } = req.body  // action: 'approve', 'reject', or 'engineering_submit'

    if (!['approve', 'reject', 'engineering_submit'].includes(action)) {
      return res.status(400).json({ error: "Action must be 'approve', 'reject', or 'engineering_submit'" })
    }

    if (!approverUser) {
      return res.status(404).json({ error: "User not found" })
    }

    // Get the memo from received_memos for current approver
    const memo = await firebase_get(`received_memos/${approverId}/${memoId}`)
    if (!memo) {
      return res.status(404).json({ error: "R&D Project memo not found" })
    }

    const projectData = {
      memoId: memo.memoId,
      title: memo.title,
      content: memo.content,
      projectName: memo.title?.replace('R&D Project: ', '').replace(' - Engineering Review', '').replace(' - Final Approval', '') || '',
      stage: memo.stage || 'marketing_pending',
      senderId: memo.senderId,
      senderName: memo.senderName,
      initiatorUserId: memo.senderId,
      docNumber: memo.docNumber || ''
    }

    // Get approver roles
    const rolesData = await firebase_get('rd_project_roles')
    const approverUserId = rolesData?.approverUserId
    const engineerUserId = rolesData?.engineerUserId

    console.log('🔧 [APPROVE_MEMO]', {
      memoId,
      action,
      approverId,
      stage: projectData.stage,
      approverUserId,
      engineerUserId
    })

    // Verify approver is authorized based on current stage and action
    if (projectData.stage === 'marketing_pending') {
      // Only approver (assigned user) or admin can approve in marketing stage
      if (approverId !== approverUserId && approverUser.role !== 'admin') {
        return res.status(403).json({ error: "Only the assigned approver can approve in this stage" })
      }
    } else if (projectData.stage === 'engineering_pending') {
      // Only engineer (assigned user) can submit engineering section data
      if (approverId !== engineerUserId) {
        return res.status(403).json({ error: "Only the assigned engineer can submit engineering data" })
      }
      // Engineering stage only accepts engineering_submit, not approve
      if (action !== 'engineering_submit') {
        return res.status(400).json({ error: "Engineering stage requires engineering_submit action, not approve" })
      }
    } else if (projectData.stage === 'final_approval') {
      // Only approver (assigned user) or admin can give final approval
      if (approverId !== approverUserId && approverUser.role !== 'admin') {
        return res.status(403).json({ error: "Only the approver can give final approval" })
      }
    } else {
      return res.status(400).json({ error: "Project is not in a pending approval stage" })
    }

    // Handle engineering submit (engineer submitting the engineering section)
    if (action === 'engineering_submit') {
      // Extract engineering data from request
      const { rawMaterialCost, otherCost, productionCost, totalCost, moq, breakEvenPoint } = req.body

      // Extract base project ID from memoId (remove _engineering_XXX suffix)
      const baseProjectId = memoId.split('_engineering_')[0]

      // Debug log
      console.log('🔧 [ENGINEERING_SUBMIT]', {
        memoId,
        baseProjectId,
        approverId,
        approverUserId,
        engineerUserId,
        memo: { stage: memo.stage, senderId: memo.senderId }
      })

      const approver = await firebase_get(`users/${approverUserId}`)

      // Update the engineering memo in received_memos for ENGINEER (mark as submitted) with engineering data
      const submittedEngineeringMemo = {
        ...memo,
        status: 'pending_approval',
        submittedBy: approverId,
        submittedByName: `${approverUser.name} ${approverUser.surname}`,
        submittedAt: new Date().toISOString(),
        engineeringData: {
          rawMaterialCost,
          otherCost,
          productionCost,
          totalCost,
          moq,
          breakEvenPoint
        },
        content: {
          ...memo.content,
          'Raw Material Cost': rawMaterialCost,
          'Other Cost': otherCost,
          'Production Cost': productionCost,
          'Total Cost': totalCost,
          'MOQ': moq,
          'Break-even Point': breakEvenPoint
        }
      }
      await firebase_set(`received_memos/${engineerUserId}/${memoId}`, submittedEngineeringMemo)

      // Create final_approval memo for approver in received_memos for final review
      const finalApprovalMemoId = `${baseProjectId}_final_${Date.now()}`

      // Merge engineering data into content
      const contentWithEngineering = {
        ...memo.content,
        'Raw Material Cost': rawMaterialCost,
        'Other Cost': otherCost,
        'Production Cost': productionCost,
        'Total Cost': totalCost,
        'MOQ': moq,
        'Break-even Point': breakEvenPoint
      }

      const finalApprovalMemoData = {
        memoId: finalApprovalMemoId,
        type: 'R&D Project',
        title: `R&D Project: ${projectData.projectName} - Final Approval`,
        content: contentWithEngineering,
        projectId: baseProjectId,
        stage: 'final_approval',
        senderId: approverId,
        senderName: `${approverUser.name} ${approverUser.surname}`,
        senderUserId: approverId,
        senderObject: {
          userId: approverId,
          name: approverUser.name,
          surname: approverUser.surname,
          username: approverUser.username,
          department: approverUser.department,
          department2: approverUser.department2
        },
        recipientId: approverUserId,
        recipientName: approver?.name ? `${approver.name} ${approver.surname}` : 'Approver',
        recipientIds: [approverUserId],
        recipientObjects: [{
          systemUserId: approverUserId,
          name: approver?.name ? `${approver.name} ${approver.surname}` : 'Approver',
          department: approver?.department || '',
          department2: approver?.department2 || ''
        }],
        sentAt: new Date().toISOString(),
        status: 'pending_approval',
        docNumber: memo.docNumber || '',
        isRDProject: true,
        approvalType: 'final',
        submittedAt: new Date().toISOString(),
        submittedBy: approverId,
        submittedByName: `${approverUser.name} ${approverUser.surname}`,
        imageUrl: memo.imageUrl || ''
      }
      await firebase_set(`received_memos/${approverUserId}/${finalApprovalMemoId}`, finalApprovalMemoData)

      console.log('✅ [FINAL_APPROVAL_CREATED]', {
        saveLocation: `received_memos/${approverUserId}/${finalApprovalMemoId}`,
        approverUserId,
        expectedUserId: 'user_1774408705336' // Phanuwat
      })

      // Create notification for approver for final review
      if (approver) {
        const notification = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          title: 'R&D Project Final Approval',
          message: `R&D project "${projectData.projectName}" engineering section completed by ${approverUser.name} ${approverUser.surname}. Ready for your final approval.`,
          type: 'rdproject_pending_final',
          read: false,
          timestamp: new Date().toISOString(),
          memoId: finalApprovalMemoId,
          stage: 'final_approval',
          submittedByName: `${approverUser.name} ${approverUser.surname}`
        }
        await firebase_set(`notifications/${approverUserId}/${notification.id}`, notification)

        // Send LINE message to approver
        try {
          if (approver.linkedFollowers) {
            const approverFollowerIds = Object.keys(approver.linkedFollowers)
            if (approverFollowerIds.length > 0) {
              const lineMessage = {
                type: "flex",
                altText: `R&D Project Final Approval: ${projectData.projectName}`,
                contents: {
                  type: "bubble",
                  header: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "text",
                        text: "✅ R&D Project Final Approval",
                        weight: "bold",
                        color: "#1a5c3a",
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
                        text: projectData.projectName,
                        weight: "bold",
                        size: "lg",
                        wrap: true,
                        color: "#182034"
                      },
                      {
                        type: "text",
                        text: `Status: ⏳ Awaiting Your Final Approval`,
                        size: "sm",
                        color: "#1a2740",
                        weight: "bold",
                        margin: "md"
                      },
                      {
                        type: "text",
                        text: `Engineering Completed by: ${approverUser.name} ${approverUser.surname}`,
                        size: "sm",
                        color: "#1a5c3a",
                        weight: "bold",
                        margin: "md"
                      },
                      {
                        type: "separator",
                        margin: "md"
                      },
                      {
                        type: "text",
                        text: `All sections completed. Please review and provide final approval.`,
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
                          label: "Final Review & Approve",
                          uri: "https://rmcmemorandum.onrender.com/"
                        },
                        style: "primary",
                        color: "#1a5c3a"
                      }
                    ]
                  }
                }
              }

              for (const followerId of approverFollowerIds) {
                try {
                  await client.pushMessage(followerId, lineMessage)
                } catch (lineErr) {
                  // Silent error
                }
              }
            }
          }
        } catch (lineErr) {
          // Silent error
        }
      }

      addLog('info', 'rd_project_engineering_submitted', {
        memoId,
        projectName: projectData.projectName,
        submittedByName: `${approverUser.name} ${approverUser.surname}`,
        docNumber: projectData.docNumber,
        nextStage: 'final_approval'
      })

      return res.json({
        status: "R&D Project engineering submitted - awaiting final approval",
        memoId,
        nextStage: 'final_approval'
      })
    }

    if (action === 'reject') {
      // Handle rejection - update memo status to rejected
      const updatedMemo = {
        ...memo,
        status: 'rejected',
        rejectedBy: approverId,
        rejectedByName: `${approverUser.name} ${approverUser.surname}`,
        rejectedAt: new Date().toISOString(),
        rejectionReason: notes || 'No reason provided',
        sentAt: memo.sentAt || new Date().toISOString()  // Preserve original sentAt
      }

      // Update in received_memos for current approver
      await firebase_set(`received_memos/${approverId}/${memoId}`, updatedMemo)

      // Also update sent_memos for initiator
      await firebase_set(`sent_memos/${memo.senderId}/${memoId}`, updatedMemo)

      // Notify initiator of rejection
      const initiator = await firebase_get(`users/${projectData.initiatorUserId}`)
      if (initiator) {
        const notification = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          title: 'R&D Project Rejected',
          message: `Your R&D project "${projectData.projectName}" was rejected by ${approverUser.name} ${approverUser.surname}: ${updatedMemo.rejectionReason}`,
          type: 'rdproject_rejected',
          read: false,
          timestamp: new Date().toISOString(),
          memoId,
          rejectedBy: approverId,
          reason: updatedMemo.rejectionReason
        }
        await firebase_set(`notifications/${projectData.initiatorUserId}/${notification.id}`, notification)
      }

      addLog('info', 'rd_project_rejected', {
        memoId,
        projectName: projectData.projectName,
        rejectedByName: `${approverUser.name} ${approverUser.surname}`,
        docNumber: projectData.docNumber,
        rejectionReason: updatedMemo.rejectionReason,
        stage: projectData.stage
      })

      return res.json({
        status: "R&D Project rejected",
        memoId,
        stage: 'rejected'
      })
    }

    // Handle approval - route to next stage
    if (projectData.stage === 'marketing_pending') {
      // Marketing stage approval -> route to engineer (user3)
      const engineer = await firebase_get(`users/${engineerUserId}`)

      // Update the original memo in received_memos for approver (mark as pending engineering)
      const approvedMemo = {
        ...memo,
        status: 'pending_engineering',
        approvedBy: approverId,
        approvedByName: `${approverUser.name} ${approverUser.surname}`,
        approvedAt: new Date().toISOString(),
        stage: 'marketing_pending',
        notes: notes || '',
        sentAt: memo.sentAt || new Date().toISOString()  // Preserve original sentAt
      }
      await firebase_set(`received_memos/${approverId}/${memoId}`, approvedMemo)

      // Also update sent_memos for initiator - preserve original sentAt
      const sentMemosUpdate = {
        ...approvedMemo,
        sentAt: memo.sentAt || new Date().toISOString()  // Ensure sentAt is preserved
      }
      await firebase_set(`sent_memos/${memo.senderId}/${memoId}`, sentMemosUpdate)

      // Create engineering_pending memo for engineer in received_memos
      const engineeringMemoId = `${memoId}_engineering_${Date.now()}`
      const engineeringMemoData = {
        memoId: engineeringMemoId,
        type: 'R&D Project',
        title: `R&D Project: ${projectData.projectName} - Engineering Review`,
        content: memo.content,
        projectId: memoId,
        stage: 'engineering_pending',
        senderId: approverId,
        senderName: `${approverUser.name} ${approverUser.surname}`,
        senderUserId: approverId,
        senderObject: {
          userId: approverId,
          name: approverUser.name,
          surname: approverUser.surname,
          username: approverUser.username,
          department: approverUser.department,
          department2: approverUser.department2
        },
        recipientId: engineerUserId,
        recipientName: engineer?.name ? `${engineer.name} ${engineer.surname}` : 'Engineer',
        recipientIds: [engineerUserId],
        recipientObjects: [{
          systemUserId: engineerUserId,
          name: engineer?.name ? `${engineer.name} ${engineer.surname}` : 'Engineer',
          department: engineer?.department || '',
          department2: engineer?.department2 || ''
        }],
        sentAt: new Date().toISOString(),
        status: 'pending_approval',
        docNumber: memo.docNumber || '',
        isRDProject: true,
        approvalType: 'engineering',
        imageUrl: memo.imageUrl || ''
      }
      await firebase_set(`received_memos/${engineerUserId}/${engineeringMemoId}`, engineeringMemoData)

      // Create notification for engineer
      if (engineer) {
        const notification = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          title: 'R&D Project Awaiting Engineering Review',
          message: `R&D project "${projectData.projectName}" approved by marketing. Now awaiting your engineering input.`,
          type: 'rdproject_pending_engineering',
          read: false,
          timestamp: new Date().toISOString(),
          memoId,
          stage: 'engineering_pending',
          approvedByName: `${approverUser.name} ${approverUser.surname}`
        }
        await firebase_set(`notifications/${engineerUserId}/${notification.id}`, notification)

        // Send LINE message to engineer
        try {
          if (engineer.linkedFollowers) {
            const engineerFollowerIds = Object.keys(engineer.linkedFollowers)
            if (engineerFollowerIds.length > 0) {
              const lineMessage = {
                type: "flex",
                altText: `R&D Project Engineering Review: ${projectData.projectName}`,
                contents: {
                  type: "bubble",
                  header: {
                    type: "box",
                    layout: "vertical",
                    contents: [
                      {
                        type: "text",
                        text: "⚙️ R&D Project Engineering",
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
                        text: projectData.projectName,
                        weight: "bold",
                        size: "lg",
                        wrap: true,
                        color: "#182034"
                      },
                      {
                        type: "text",
                        text: `Status: ⏳ Awaiting Your Input`,
                        size: "sm",
                        color: "#1a2740",
                        weight: "bold",
                        margin: "md"
                      },
                      {
                        type: "text",
                        text: `Approved by: ${approverUser.name} ${approverUser.surname}`,
                        size: "sm",
                        color: "#1a5c3a",
                        weight: "bold",
                        margin: "md"
                      },
                      {
                        type: "separator",
                        margin: "md"
                      },
                      {
                        type: "text",
                        text: `Stage: Engineering Review\n\nPlease complete the engineering section and provide cost analysis.`,
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
                          label: "Fill Engineering Section",
                          uri: "https://rmcmemorandum.onrender.com/"
                        },
                        style: "primary",
                        color: "#1a2740"
                      }
                    ]
                  }
                }
              }

              for (const followerId of engineerFollowerIds) {
                try {
                  await client.pushMessage(followerId, lineMessage)
                } catch (lineErr) {
                  // Silent error
                }
              }
            }
          }
        } catch (lineErr) {
          // Silent error
        }
      }

      addLog('info', 'rd_project_marketing_approved', {
        memoId,
        projectName: projectData.projectName,
        approvedByName: `${approverUser.name} ${approverUser.surname}`,
        docNumber: projectData.docNumber,
        nextStage: 'engineering_pending'
      })

      return res.json({
        status: "R&D Project approved - routed to engineer",
        memoId,
        nextStage: 'engineering_pending',
        nextApprover: `${engineer?.name} ${engineer?.surname}`
      })
    }

    if (projectData.stage === 'final_approval') {
      // Final approval - project is approved
      const engineer = await firebase_get(`users/${engineerUserId}`)

      // Extract base project ID from final memoId (remove _final_XXX suffix)
      const baseProjectId = memoId.split('_final_')[0]

      // Find the ORIGINAL initiator from original sent_memos
      let originalInitiatorUserId = projectData.initiatorUserId
      const allUsers = await firebase_get('users')
      if (allUsers && typeof allUsers === 'object') {
        for (const [userId, userObj] of Object.entries(allUsers)) {
          const sentMemos = await firebase_get(`sent_memos/${userId}`)
          if (sentMemos && sentMemos[baseProjectId] && sentMemos[baseProjectId].isRDProject) {
            originalInitiatorUserId = userId
            break
          }
        }
      }

      const initiator = await firebase_get(`users/${originalInitiatorUserId}`)

      // Update the final approval memo in received_memos for approver (mark as approved)
      const approvedFinalMemo = {
        memoId: baseProjectId,
        type: 'R&D Project',
        title: `R&D Project: ${projectData.projectName}`,
        content: memo.content,  // Complete data with engineering
        projectId: baseProjectId,
        stage: 'final_approval',
        senderId: originalInitiatorUserId,
        senderName: initiator ? `${initiator.name} ${initiator.surname}` : 'Unknown',
        senderUserId: originalInitiatorUserId,
        senderObject: initiator ? {
          userId: originalInitiatorUserId,
          name: initiator.name,
          surname: initiator.surname,
          username: initiator.username,
          department: initiator.department,
          department2: initiator.department2
        } : null,
        recipientId: approverUserId,
        recipientIds: [approverUserId],
        recipientName: `${approverUser.name} ${approverUser.surname}`,
        recipientObjects: [{
          systemUserId: approverUserId,
          name: `${approverUser.name} ${approverUser.surname}`,
          department: approverUser.department,
          department2: approverUser.department2
        }],
        sentAt: new Date().toISOString(),
        status: 'completed',
        docNumber: projectData.docNumber || '',
        isRDProject: true,
        approvalType: 'final',
        approvedBy: approverId,
        approvedByName: `${approverUser.name} ${approverUser.surname}`,
        approvedAt: new Date().toISOString(),
        submittedAt: memo.submittedAt || new Date().toISOString(),
        submittedBy: memo.submittedBy,
        submittedByName: memo.submittedByName,
        notes: notes || '',
        imageUrl: memo.imageUrl || ''
      }
      await firebase_set(`received_memos/${approverId}/${baseProjectId}`, approvedFinalMemo)

      // UPDATE SENT_MEMOS FOR ORIGINAL INITIATOR with the final completed version (with all engineering data)
      // Fetch original memo from initiator's sent_memos to preserve sender info
      const originalInitiatorMemo = await firebase_get(`sent_memos/${originalInitiatorUserId}/${baseProjectId}`)

      // Rebuild final memo with all data and correct sender info
      const finalCompletedMemoForInitiator = {
        memoId: baseProjectId,
        type: 'R&D Project',
        title: `R&D Project: ${projectData.projectName}`,
        content: memo.content,  // This has all the engineering data merged
        projectId: baseProjectId,
        stage: 'final_approval',
        senderId: originalInitiatorUserId,  // Keep original initiator as sender
        senderName: initiator ? `${initiator.name} ${initiator.surname}` : 'Unknown',
        senderUserId: originalInitiatorUserId,
        senderObject: initiator ? {
          userId: originalInitiatorUserId,
          name: initiator.name,
          surname: initiator.surname,
          username: initiator.username,
          department: initiator.department,
          department2: initiator.department2
        } : null,
        recipientId: approverUserId,
        recipientName: approverUser ? `${approverUser.name} ${approverUser.surname}` : 'Approver',
        recipientIds: [approverUserId],
        recipientObjects: [{
          systemUserId: approverUserId,
          name: approverUser ? `${approverUser.name} ${approverUser.surname}` : 'Approver',
          department: approverUser?.department || '',
          department2: approverUser?.department2 || ''
        }],
        sentAt: originalInitiatorMemo?.sentAt || new Date().toISOString(),
        status: 'completed',
        docNumber: originalInitiatorMemo?.docNumber || memo.docNumber || '',
        isRDProject: true,
        approvalType: 'final',
        approvedBy: approverId,
        approvedByName: `${approverUser.name} ${approverUser.surname}`,
        approvedAt: new Date().toISOString(),
        submittedAt: memo.submittedAt || new Date().toISOString(),
        submittedBy: memo.submittedBy,
        submittedByName: memo.submittedByName,
        notes: notes || '',
        imageUrl: originalInitiatorMemo?.imageUrl || memo.imageUrl || ''
      }
      await firebase_set(`sent_memos/${originalInitiatorUserId}/${baseProjectId}`, finalCompletedMemoForInitiator)

      // ALSO SEND FINAL COMPLETED MEMO TO ENGINEER (1) - in their received_memos
      const completedMemoForEngineer = {
        memoId: baseProjectId,
        type: 'R&D Project',
        title: `R&D Project: ${projectData.projectName}`,
        content: memo.content,  // Complete data with engineering
        projectId: baseProjectId,
        stage: 'final_approval',
        senderId: originalInitiatorUserId,
        senderName: initiator ? `${initiator.name} ${initiator.surname}` : 'Unknown',
        senderUserId: originalInitiatorUserId,
        senderObject: initiator ? {
          userId: originalInitiatorUserId,
          name: initiator.name,
          surname: initiator.surname,
          username: initiator.username,
          department: initiator.department,
          department2: initiator.department2
        } : null,
        recipientId: engineerUserId,
        recipientIds: [engineerUserId],
        recipientName: engineer ? `${engineer.name} ${engineer.surname}` : 'Unknown',
        recipientObjects: [{
          systemUserId: engineerUserId,
          name: engineer ? `${engineer.name} ${engineer.surname}` : 'Unknown',
          department: engineer?.department || '',
          department2: engineer?.department2 || ''
        }],
        sentAt: new Date().toISOString(),
        approvalType: 'final',
        approvedBy: approverId,
        approvedByName: `${approverUser.name} ${approverUser.surname}`,
        approvedAt: new Date().toISOString(),
        submittedAt: memo.submittedAt || new Date().toISOString(),
        submittedBy: memo.submittedBy,
        submittedByName: memo.submittedByName,
        notes: notes || '',
        docNumber: projectData.docNumber || '',
        acknowledgmentFeedback: memo.acknowledgmentFeedback || {},
        acknowledgments: memo.acknowledgments || {},
        status: 'completed'
      }
      await firebase_set(`received_memos/${engineerUserId}/${baseProjectId}`, completedMemoForEngineer)

      // Delete intermediate memos (engineering_pending) from engineer's received_memos
      // Find and delete engineering_pending memo
      const engineerReceivedMemos = await firebase_get(`received_memos/${engineerUserId}`)
      if (engineerReceivedMemos && typeof engineerReceivedMemos === 'object') {
        for (let memoIdKey in engineerReceivedMemos) {
          if (memoIdKey.includes('_engineering_')) {
            await firebase_delete(`received_memos/${engineerUserId}/${memoIdKey}`)
          }
        }
      }

      // Also delete old memos from approver's received_memos if they exist (marketing versions)
      const approverReceivedMemos = await firebase_get(`received_memos/${approverId}`)
      if (approverReceivedMemos && typeof approverReceivedMemos === 'object') {
        for (let memoIdKey in approverReceivedMemos) {
          // Delete intermediate versions like marketing_pending or final_pending, keep only base version
          if (memoIdKey.includes(baseProjectId) && (memoIdKey.includes('_final_') || memoIdKey.includes('_engineering_'))) {
            await firebase_delete(`received_memos/${approverId}/${memoIdKey}`)
          }
        }
      }

      // Also delete marketing_pending memo from initiator's sent_memos if exists
      const initiatorSentMemos = await firebase_get(`sent_memos/${originalInitiatorUserId}`)
      if (initiatorSentMemos && typeof initiatorSentMemos === 'object') {
        for (let memoIdKey in initiatorSentMemos) {
          // Delete old intermediate versions, keep only final base version
          if (memoIdKey.includes(baseProjectId) && memoIdKey !== baseProjectId && (memoIdKey.includes('_final_') || memoIdKey.includes('_engineering_'))) {
            await firebase_delete(`sent_memos/${originalInitiatorUserId}/${memoIdKey}`)
          }
        }
      }

      // IMPORTANT: Delete engineer's sent_memos entry if it exists (engineer should NOT have sent_memos)
      const engineerSentMemos = await firebase_get(`sent_memos/${engineerUserId}`)
      if (engineerSentMemos && engineerSentMemos[baseProjectId]) {
        await firebase_delete(`sent_memos/${engineerUserId}/${baseProjectId}`)
      }

      // Notify initiator of completion
      if (initiator) {
        const notification = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          title: 'R&D Project Completed',
          message: `R&D project "${projectData.projectName}" has been approved by ${approverUser.name} ${approverUser.surname} and is complete.`,
          type: 'rdproject_completed',
          read: false,
          timestamp: new Date().toISOString(),
          memoId: baseProjectId,
          stage: 'completed',
          approvedByName: `${approverUser.name} ${approverUser.surname}`
        }
        await firebase_set(`notifications/${originalInitiatorUserId}/${notification.id}`, notification)
      }

      if (engineer) {
        const notification = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          title: 'R&D Project Approved',
          message: `Your R&D project "${projectData.projectName}" has been approved and is now complete.`,
          type: 'rdproject_approved',
          read: false,
          timestamp: new Date().toISOString(),
          memoId: baseProjectId,
          stage: 'completed',
          approvedByName: `${approverUser.name} ${approverUser.surname}`
        }
        await firebase_set(`notifications/${engineerUserId}/${notification.id}`, notification)
      }

      // Send LINE messages to both initiator and engineer
      try {
        if (initiator && initiator.linkedFollowers) {
          const initiatorFollowerIds = Object.keys(initiator.linkedFollowers)
          if (initiatorFollowerIds.length > 0) {
            const lineMessage = {
              type: "flex",
              altText: `R&D Project Approved: ${projectData.projectName}`,
              contents: {
                type: "bubble",
                header: {
                  type: "box",
                  layout: "vertical",
                  contents: [
                    {
                      type: "text",
                      text: "✅ R&D Project Approved",
                      weight: "bold",
                      color: "#1a5c3a",
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
                      text: projectData.projectName,
                      weight: "bold",
                      size: "lg",
                      wrap: true,
                      color: "#182034"
                    },
                    {
                      type: "text",
                      text: `Approved by: ${approverUser.name} ${approverUser.surname}`,
                      size: "sm",
                      color: "#1a5c3a",
                      weight: "bold",
                      margin: "md"
                    },
                    {
                      type: "separator",
                      margin: "md"
                    },
                    {
                      type: "text",
                      text: `Your R&D project has been successfully approved and is ready for implementation.`,
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
                        label: "View Project Details",
                        uri: "https://rmcmemorandum.onrender.com/"
                      },
                      style: "primary",
                      color: "#1a5c3a"
                    }
                  ]
                }
              }
            }

            for (const followerId of initiatorFollowerIds) {
              try {
                await client.pushMessage(followerId, lineMessage)
              } catch (lineErr) {
                // Silent error
              }
            }
          }
        }

        if (engineer && engineer.linkedFollowers) {
          const engineerFollowerIds = Object.keys(engineer.linkedFollowers)
          if (engineerFollowerIds.length > 0) {
            const lineMessage = {
              type: "flex",
              altText: `R&D Project Completed: ${projectData.projectName}`,
              contents: {
                type: "bubble",
                header: {
                  type: "box",
                  layout: "vertical",
                  contents: [
                    {
                      type: "text",
                      text: "✅ R&D Project Completed",
                      weight: "bold",
                      color: "#1a5c3a",
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
                      text: projectData.projectName,
                      weight: "bold",
                      size: "lg",
                      wrap: true,
                      color: "#182034"
                    },
                    {
                      type: "text",
                      text: `Final Approved by: ${approverUser.name} ${approverUser.surname}`,
                      size: "sm",
                      color: "#1a5c3a",
                      weight: "bold",
                      margin: "md"
                    },
                    {
                      type: "separator",
                      margin: "md"
                    },
                    {
                      type: "text",
                      text: `R&D project has been completed with your engineering input and has received final approval.`,
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
                        label: "View Project Details",
                        uri: "https://rmcmemorandum.onrender.com/"
                      },
                      style: "primary",
                      color: "#1a5c3a"
                    }
                  ]
                }
              }
            }

            for (const followerId of engineerFollowerIds) {
              try {
                await client.pushMessage(followerId, lineMessage)
              } catch (lineErr) {
                // Silent error
              }
            }
          }
        }
      } catch (lineErr) {
        // Silent error - LINE notification not critical
      }

      addLog('info', 'rd_project_completed', {
        memoId,
        projectName: projectData.projectName,
        approvedByName: `${approverUser.name} ${approverUser.surname}`,
        docNumber: projectData.docNumber,
        stage: 'completed'
      })

      return res.json({
        status: "R&D Project approved and completed",
        memoId,
        stage: 'completed'
      })
    }

  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3000

// Health check endpoint
app.get('/ping', (req, res) => {
  res.status(200).send('OK')
})

app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`✅ Server started on port ${PORT}`)
  console.log(`${'='.repeat(60)}`)
  console.log(`🌐 Webhook URL: https://rmcmemorandum.onrender.com/webhook`)
  console.log(`📡 Webhook Status: READY TO RECEIVE EVENTS`)
  console.log(`📝 Expected Events: follow, unfollow, message`)
  console.log(`🔐 Signature Verification: ENABLED`)
  console.log(`🗄️  Firebase Database: ${FIREBASE_DB_URL}`)
  console.log(`${'='.repeat(60)}\n`)
})

