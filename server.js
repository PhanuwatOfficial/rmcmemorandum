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

const config = {
  channelAccessToken: "b2fh2LSS5Tol02wcgAaglG69RToFh2PBEJ0rmt+2+usd1j9QnOdlo9iQav/mgM9WqTGTfbqPFNGlyy2dc3/4VJge9GCvwHhgPsWNzdk+b+n8/m/wfW91odnR57Y6T32Ibj6i6p3DOv8ujtXzybwdtgdB04t89/1O/w1cDnyilFU=",
  channelSecret: "8b11f8b0519a6b827f6c0c69664cf207"
}

const client = new line.Client(config)

// Firebase Realtime Database (ใช้ REST API แทน Admin SDK)
// const FIREBASE_PROJECT_ID = "line-6191d"
const FIREBASE_PROJECT_ID = "test2-a3a49"

// const FIREBASE_DB_URL = "https://import-acd62-default-rtdb.asia-southeast1.firebasedatabase.app"
// const FIREBASE_DB_URL = "https://line-6191d-default-rtdb.asia-southeast1.firebasedatabase.app"
const FIREBASE_DB_URL = "https://test2-a3a49-default-rtdb.asia-southeast1.firebasedatabase.app"



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

    // สร้าง token
    const token = createToken()
    sessions[token] = userId

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
    const userId = sessions[token]

    if (userId) {
      const user = await firebase_get(`users/${userId}`)
      delete sessions[token]
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
    const userId = sessions[req.headers.authorization?.split(' ')[1]]
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
    const token = req.headers.authorization?.split(' ')[1]
    const adminId = sessions[token]
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
    const token = req.headers.authorization?.split(' ')[1]
    const adminId = sessions[token]
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

// Get all memo approvers
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

  const { title, type, content, senderUserId, docNumber, imageUrl } = req.body

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
      imageUrl: imageUrl || null,
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
        message: `"${title}" กำลังรอการอนุมัติจาก ${memoApprovers.length} ผู้อนุมัติ`,
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
              }
            })
          }
        }
      })
    } else {
      // Regular approver - check if user is in memoApprovers
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

      // If user is not an approver, return empty list
      if (userApprovals.length === 0) {
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

      senderIds.forEach((senderId, idx) => {
        const sender = allUsers[senderId]
        const sentMemos = allSentMemosArray[idx]

        if (!sentMemos || typeof sentMemos !== 'object') return

        for (let memoId in sentMemos) {
          const memo = sentMemos[memoId]

          // Check if memo is pending approval
          if (memo.status === 'pending_approval') {

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
                }
              })
            }
          }
        }
      })
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

    // Check if user is admin - admins can approve any memo without memoApprovers check
    let isAuthorizedApprover = false

    if (currentUser.role === 'admin') {
      // Admins can approve any memo
      isAuthorizedApprover = true
    } else {
      // Verify current user is an authorized approver
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

    let isAuthorizedApprover = false

    if (approvers && typeof approvers === 'object') {
      for (const approver of Object.values(approvers)) {
        if (approver.approverId === req.userId &&
          approver.departmentId === senderDepartmentId &&
          (!approver.subDepartmentId || approver.subDepartmentId === sender.department2)) {
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
    // เมื่อมีคนกด follow
    if (event.type === 'follow') {
      const userId = event.source.userId
      try {
        // ดึง profile จาก LINE
        let profile = null
        try {
          profile = await client.getProfile(userId)
        } catch (profileErr) {
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
        
        // บันทึก log ที่ครบถ้วนเข้า Firebase logs
        addLog('info', 'New followers', {
          userId: userId,
          displayName: profile.displayName || 'Unknown',
          pictureUrl: profile.pictureUrl || null,
          statusMessage: profile.statusMessage || null,
          followedAt: new Date().toISOString()
        })
      } catch (fbErr) {
        // Silent error handling
      }
    }

    // เมื่อมีคนกด unfollow
    if (event.type === 'unfollow') {
      const userId = event.source.userId
      try {
        await firebase_delete(`followers/${userId}`)
      } catch (fbErr) {
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
        // Handle system user recipient (recipientUserId)
        if (memo.recipientUserId && allUsers) {
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
          if (memo.recipientId && memo.recipientId.startsWith('U')) {
            const sender = allUsers[senderId]
            if (sender) {
              memo.senderName = `${sender.name} ${sender.surname}`
              memo.senderUserId = senderId
            }
            receivedMemos.push(memo)
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
            receivedMemos.push(directReceivedMemos[memoId])
          }
        }
      })
    } else {
      // Regular user gets only memos for their linked followers
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
              receivedMemos.push(memo)
            }
          }
        })
      }

      // Direct received memos
      const directReceivedMemos = await firebase_get(`received_memos/${userId}`)
      if (directReceivedMemos && typeof directReceivedMemos === 'object') {
        for (let memoId in directReceivedMemos) {
          receivedMemos.push(directReceivedMemos[memoId])
        }
      }
    }

    // Sort by sentAt descending (newest first)
    receivedMemos.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))

    res.json({ memos: receivedMemos, count: receivedMemos.length })
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

    // Check authorization - only admin can edit
    const user = await firebase_get(`users/${userId}`)
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can edit memos' })
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

    // First, search in sent_memos
    for (const [uid, userObj] of Object.entries(allUsers)) {
      const sentMemos = await firebase_get(`sent_memos/${uid}`)
      if (sentMemos && sentMemos[memoId]) {
        memoPath = `sent_memos/${uid}/${memoId}`
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
          memoFound = true
          isReceivedMemo = true
          break
        }
      }
    }

    if (!memoFound) {
      return res.status(404).json({ error: 'Memo not found' })
    }

    // Get the existing memo
    const existingMemo = await firebase_get(memoPath)
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
    try {
      const logEntry = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        action: 'memo_edited',
        admin: user.username,
        memoId: memoId,
        title: title
      }
      await firebase_set(`logs/${logEntry.id}`, logEntry)
    } catch (e) {
      // Silent logging error
    }

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

    // Check authorization - only admin can delete
    const user = await firebase_get(`users/${userId}`)
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can delete memos' })
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

    // Search in sent_memos first
    for (const [uid, userObj] of Object.entries(allUsers)) {
      const sentMemos = await firebase_get(`sent_memos/${uid}`)
      if (sentMemos && sentMemos[memoId]) {
        memoPath = `sent_memos/${uid}/${memoId}`
        memoData = sentMemos[memoId]
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
          memoData = receivedMemos[memoId]
          memoFound = true
          isReceivedMemo = true
          break
        }
      }
    }

    if (!memoFound) {
      return res.status(404).json({ error: 'Memo not found' })
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
    try {
      const logEntry = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        action: 'memo_deleted',
        admin: user.username,
        memoId: memoId,
        title: memoData?.title || 'Unknown'
      }
      await firebase_set(`logs/${logEntry.id}`, logEntry)
    } catch (e) {
      // Silent logging error
    }

    res.json({ success: true, message: 'Memo deleted successfully' })
  } catch (err) {
    console.error('Error deleting memo:', err)
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

    const { title, type, content, docNumber, imageUrl } = req.body
    const senderUserId = req.userId

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
      imageUrl: imageUrl || null,
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

const PORT = process.env.PORT || 3000

// Health check endpoint
app.get('/ping', (req, res) => {
  res.status(200).send('OK')
})

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`)
})