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

// Determine if a message should be logged (filtering important events only)
function shouldLogMessage(message) {
  const importantKeywords = [
    'login successful',
    'logout successful',
    'user registered',
    'user approved',
    'user rejected',
    'followers follow',
    'followers unfollow',
    'send message request',
    'password changed'
  ]
  
  const msg = message.toLowerCase()
  return importantKeywords.some(keyword => msg.includes(keyword))
}

function addLog(level, message, data = null) {
  const timestamp = new Date().toISOString()
  const logEntry = {
    timestamp,
    level,
    message,
    data
  }
  
  // Only log if message contains important keywords
  if (shouldLogMessage(message)) {
    logs.push(logEntry)
    
    // เก็บ max 1000 logs
    if (logs.length > MAX_LOGS) {
      logs.shift()
    }
    
    // บันทึก log ลงใน Firebase
    firebase_set(`logs/${Date.now()}`, logEntry).catch(err => {
      // ถ้า Firebase error ก็ไม่ต้อง crash
    })
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
  console.log('🔑 [AUTH] Verify token called')
  console.log('   - Auth header:', authHeader ? authHeader.substring(0, 30) + '...' : 'MISSING')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ [AUTH] Invalid or missing token')
    return res.status(401).json({ error: 'No token provided' })
  }
  
  const token = authHeader.substring(7)
  console.log('   - Token:', token.substring(0, 20) + '...')
  console.log('   - Token exists in sessions:', !!sessions[token])
  
  const userId = sessions[token]
  
  if (!userId) {
    console.log('❌ [AUTH] Token not found in sessions')
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
  
  console.log('✅ [AUTH] Token verified for userId:', userId)
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
    
    addLog('info', 'Register attempt', { username })
    
    // เช็คว่า username มีอยู่แล้วหรือไม่
    const existingUser = await firebase_get(`users_by_username/${username}`)
    if (existingUser) {
      addLog('warn', 'Username already exists', { username })
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
    
    // หา user ด้วย username
    const userRef = await firebase_get(`users_by_username/${username}`)
    if (!userRef) {
      addLog('warn', 'Login failed - user not found', { username })
      return res.status(401).json({ error: "Invalid credentials" })
    }
    
    const userId = userRef.userId
    const user = await firebase_get(`users/${userId}`)
    
    // Check if user is pending approval
    if (user.status === 'pending') {
      addLog('warn', 'Login blocked - user pending approval', { username })
      return res.status(403).json({ error: "Your account is pending admin approval. Please wait for approval to access the system." })
    }
    
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
      addLog('info', 'Logout successful', { userId, username: user?.username })
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
          createdAt: u.createdAt
        })
      }
    }
    
    addLog('info', 'Pending users fetched', { count: pendingUsers.length })
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
    addLog('info', 'User approved', { userId: targetUserId, username: targetUser.username, approvedBy: adminId, approverUsername: approverName })
    
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
    
    addLog('warn', 'Pending user rejected and deleted', { userId: targetUserId, username: targetUser.username, rejectedBy: adminId })
    
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
    res.status(500).json({ error: err.message })
  }
})

// Update user's departments
app.post("/user/update-departments", verifyToken, async (req, res) => {
  try {
    const { department, department2 } = req.body
    
    addLog('info', 'Update departments attempt', { userId: req.userId, department, department2 })
    
    const user = await firebase_get(`users/${req.userId}`)
    if (!user) {
      return res.status(404).json({ error: "User not found" })
    }
    
    // Update departments
    user.department = department || ''
    user.department2 = department2 || ''
    await firebase_set(`users/${req.userId}`, user)
    
    addLog('info', 'Departments updated successfully', { userId: req.userId, department, department2 })
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

    addLog('info', 'Checked approver status', { userId, isApprover, approvalCount })
    res.json({ isApprover, approvalCount })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get user stats for dashboard (sent, pending, received, approved memos)
app.get("/memos/user-stats", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    console.log('📊 [STATS] Starting stats calculation for userId:', userId)
    
    // ========== SENT MEMOS ==========
    // Path: sent_memos/{userId}/{memoId}
    let sentCount = 0
    let sentMemos = null
    
    sentMemos = await firebase_get(`sent_memos/${userId}`)
    console.log('📤 [STATS] Sent memos path (sent_memos/${userId}):', sentMemos && typeof sentMemos === 'object' ? Object.keys(sentMemos).length + ' items' : 'NOT FOUND')
    
    sentCount = sentMemos && typeof sentMemos === 'object' ? Object.keys(sentMemos).length : 0
    console.log('📊 [STATS] Total sent count:', sentCount)
    
    // ========== RECEIVED MEMOS ==========
    // Path: received_memos/{userId}/{memoId}
    let receivedCount = 0
    
    const receivedMemos = await firebase_get(`received_memos/${userId}`)
    console.log('📥 [STATS] Received memos path (received_memos/${userId}):', receivedMemos && typeof receivedMemos === 'object' ? Object.keys(receivedMemos).length + ' items' : 'NOT FOUND')
    
    receivedCount = receivedMemos && typeof receivedMemos === 'object' ? Object.keys(receivedMemos).length : 0
    console.log('📊 [STATS] Total received count:', receivedCount)
    
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
      console.log('👨‍⚖️ [STATS] Pending approvals (sent memos with status=pending_approval):', pendingApprovalCount + ' items')
    }
    
    // ========== APPROVED MEMOS ==========
    let approvedCount = 0
    
    if (sentMemos && typeof sentMemos === 'object') {
      console.log('✅ [STATS] Checking approved memos in sent_memos...')
      for (let memoId in sentMemos) {
        const memo = sentMemos[memoId]
        if (memo.status === 'approved') {
          approvedCount++
        }
      }
      console.log('✅ [STATS] Total approved memos:', approvedCount)
    }
    
    const responseData = {
      sentCount,
      receivedCount,
      pendingApprovalCount,
      approvedCount
    }
    
    console.log('📡 [STATS] Final response:', responseData)
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
    
    addLog('info', 'Department added successfully', { adminId: req.userId, deptId, name })
    
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
    
    addLog('info', 'Sub-department added successfully', { adminId: req.userId, deptId, name })
    
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
    addLog('info', 'Department deleted', { adminId: req.userId, deptId })
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
    addLog('info', 'Department link created', { adminId: req.userId, linkId, departmentId, subDepartmentId })
    
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
    addLog('info', 'Department link deleted', { adminId: req.userId, linkId })
    
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
    addLog('info', 'Memo approver added', { adminId: req.userId, approverId, departmentId, subDepartmentId })
    
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
    addLog('info', 'Memo approver removed', { adminId: req.userId, approverId })
    
    res.json({ status: "Approver removed successfully" })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Send memo (now with approval workflow)
app.post("/send", async (req, res) => {
  const { userId, recipientUserId, title, type, content, senderUserId, docNumber } = req.body
  const targetUserId = userId  // This is the followerId (LINE user ID)
  // recipientUserId is the system user ID (used for approval workflow)

  try {
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

    // Check if memo requires approval based on sender's department
    const sender = senderUserId ? await firebase_get(`users/${senderUserId}`) : null
    
    // Get recipient information - use recipientUserId (system user ID) if provided, otherwise use targetUserId
    let recipientName = recipientUserId || targetUserId
    let actualRecipientUserId = recipientUserId || targetUserId
    try {
      const recipient = await firebase_get(`users/${actualRecipientUserId}`)
      if (recipient) {
        recipientName = `${recipient.name || ''} ${recipient.surname || ''}`.trim() || recipientName
      }
    } catch (err) {
      addLog('warn', 'Could not fetch recipient info', { actualRecipientUserId, error: err.message })
    }

    // Create memo object
    const memoId = `memo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const memoData = {
      memoId,
      title,
      type,
      content,
      docNumber: docNumber || '',
      recipientId: actualRecipientUserId,  // Use system user ID, not followerId
      recipientName: recipientName,
      followerId: targetUserId,  // Store the LINE followerId separately for reference
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

    addLog('info', 'Checking approvers for memo', { 
      senderUserId, 
      senderDepartmentName: sender?.department,
      senderSubDepartmentName: sender?.department2 
    })

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

      addLog('info', 'Department conversion', { 
        departmentName: sender.department,
        departmentId: senderDepartmentId
      })

      const approvers = await firebase_get('memoApprovers')
      addLog('info', 'Approvers data fetched', { approverId: approvers ? Object.keys(approvers).length : 0 })

      if (approvers && typeof approvers === 'object') {
        for (const [approverKey, approver] of Object.entries(approvers)) {
          addLog('info', 'Checking approver match', { 
            approverKey,
            approverDepartmentId: approver.departmentId,
            senderDepartmentId: senderDepartmentId,
            approverSubDeptId: approver.subDepartmentId,
            senderSubDeptId: sender.department2,
            departmentMatch: approver.departmentId === senderDepartmentId
          })

          // Check if approver can approve for this department
          if (approver.departmentId === senderDepartmentId) {
            // Either approves entire department or this specific sub-department
            // If approver has no subDepartmentId, they can approve any subdepartment in that department
            const subDeptMatch = !approver.subDepartmentId ? true : (approver.subDepartmentId === sender.department2)
            
            if (subDeptMatch) {
              addLog('info', 'Approver matched', { approverKey, approverId: approver.approverId })
              memoApprovers.push({
                approverId: approver.approverId,
                approverName: approver.approverName,
                approverUsername: approver.approverUsername
              })
            }
          }
        }
      }
    } else {
      addLog('info', 'Sender has no department assigned', { senderUserId, senderDepartment: sender?.department })
    }

    addLog('info', 'Approvers check complete', { memoApprovers: memoApprovers.length > 0 ? 'Found' : 'Not found', count: memoApprovers.length })

    // If approvers found, require approval before sending
    if (memoApprovers.length > 0) {
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
        memo: memoData,
        senderId: senderUserId,
        recipientId: actualRecipientUserId
      }
      
      try {
        console.log('📨 Creating pending_approval notification for sender:', {
          senderId: senderUserId,
          memoId: memoData.memoId,
          memoStatus: memoData.status,
          notificationType: senderNotification.type,
          hasMemoData: !!senderNotification.memo
        })
        await firebase_set(`notifications/${senderUserId}/${senderNotification.id}`, senderNotification)
        addLog('info', 'Pending approval notification sent to sender', { senderId: senderUserId, memoId })
      } catch (err) {
        addLog('warn', 'Failed to send pending approval notification to sender', { senderId: senderUserId, error: err.message })
      }
      
      // Create notifications for approvers - do NOT send to recipient yet
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
          addLog('info', 'Approval notification sent to approver', { approverId: approver.approverId, memoId, senderUserId, recipientId: actualRecipientUserId })
        } catch (err) {
          addLog('warn', 'Failed to send approval notification', { approverId: approver.approverId, error: err.message })
        }
      }

      addLog('info', 'Memo created - pending approval', { memoId, senderId: senderUserId, recipientId: actualRecipientUserId, followerId: targetUserId, approverCount: memoApprovers.length })
      return res.json({ status: "Memo created - pending approval", memoId, approverCount: memoApprovers.length })
    }

    // No approvers found - send directly (without approval)
    memoData.status = 'sent'
    memoData.approvalPending = false
    memoData.sentTime = new Date().toISOString()

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
            ...(docNumber ? [{
              type: "text",
              text: `Doc #: ${docNumber}`,
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

    // Send to recipient via LINE
    try {
      addLog('info', 'Attempting to send LINE message', { followerId: targetUserId, recipientUserId: actualRecipientUserId, memoId })
      await client.pushMessage(targetUserId, lineMessage)
      addLog('info', 'LINE message sent successfully', { followerId: targetUserId, memoId })
    } catch (lineErr) {
      addLog('error', 'Failed to send LINE message', { followerId: targetUserId, error: lineErr.message })
      // Don't throw - store the memo anyway with a note that LINE delivery failed
      memoData.lineDeliveryFailed = true
      memoData.lineDeliveryError = lineErr.message
    }

    await firebase_set(`sent_memos/${senderUserId}/${memoId}`, memoData)
    addLog('info', 'Send message request (no approval required)', { title, type, followerId: targetUserId, recipientUserId: actualRecipientUserId, senderName })

    const notification = {
      id: Date.now().toString(),
      title: 'ได้รับ Memo ใหม่',
      message: `"${title}" จาก ${senderName}`,
      type: 'info',
      read: false,
      timestamp: new Date().toISOString(),
      memoId: memoId,
      memoObject: memoData,
      memoType: 'received',
      senderId: senderUserId,
      recipientId: actualRecipientUserId,
      followerId: targetUserId
    }
    
    if (recipientUserId || actualRecipientUserId) {
      await firebase_set(`notifications/${actualRecipientUserId}/${notification.id}`, notification)
    }

    addLog('info', 'Message sent successfully (direct - no approval needed)', { followerId: targetUserId, recipientUserId: actualRecipientUserId, memoId, senderUserId })
    res.json({ status: "sent", memoId })

  } catch(err) {
    addLog('error', 'Error in /send endpoint', { 
      error: err.message, 
      stack: err.stack,
      followerId: targetUserId, 
      recipientUserId: actualRecipientUserId,
      senderUserId 
    })
    res.status(500).json({ error: err.message })
  }
})

// Get pending approvals for current user (approver only)
app.get("/memos/pending-approval", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    const currentUser = await firebase_get(`users/${userId}`)
    
    if (!currentUser) {
      return res.status(404).json({ error: "User not found" })
    }

    addLog('info', 'Getting pending approvals for approver', { 
      userId, 
      username: currentUser.username,
      department: currentUser.department,
      department2: currentUser.department2
    })

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

    addLog('info', 'User is assigned to approve', { userId, approvalCount: userApprovals.length, approvals: userApprovals })

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

    addLog('info', 'Department mapping loaded', { mappingCount: Object.keys(departmentNameToId).length })

    // Get all users and their sent_memos to find pending_approval ones
    const allUsers = await firebase_get('users')
    const pendingMemos = []
    let checkedCount = 0
    let foundCount = 0

    if (allUsers && typeof allUsers === 'object') {
      for (let senderId in allUsers) {
        const sender = allUsers[senderId]
        const sentMemos = await firebase_get(`sent_memos/${senderId}`)
        
        if (!sentMemos || typeof sentMemos !== 'object') continue

        for (let memoId in sentMemos) {
          checkedCount++
          const memo = sentMemos[memoId]
          
          // Check if memo is pending approval
          if (memo.status === 'pending_approval') {
            addLog('info', 'Found pending_approval memo', { 
              memoId, 
              senderId,
              senderDept: sender.department,
              senderDept2: sender.department2,
              memoTitle: memo.title
            })

            // Convert sender's department name to UUID
            let senderDepartmentId = sender.department
            if (departmentNameToId[sender.department]) {
              senderDepartmentId = departmentNameToId[sender.department]
              addLog('info', 'Converted sender department', { 
                departmentName: sender.department,
                departmentId: senderDepartmentId
              })
            }

            // Verify this user is one of the approvers for this sender
            const canApprove = userApprovals.some(approval => {
              const match = approval.departmentId === senderDepartmentId &&
                (!approval.subDepartmentId || approval.subDepartmentId === sender.department2)
              
              if (!match) {
                addLog('info', 'Approval no match', {
                  approvalDept: approval.departmentId,
                  approvalSubDept: approval.subDepartmentId,
                  senderDeptId: senderDepartmentId,
                  senderDept: sender.department,
                  senderSubDept: sender.department2
                })
              }
              return match
            })

            if (canApprove) {
              foundCount++
              addLog('info', 'Memo can be approved by this user', { memoId })
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
      }
    }

    // Sort by sentAt descending (newest first)
    pendingMemos.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))

    addLog('info', 'Pending approvals retrieved', { userId, checkedCount, foundCount, count: pendingMemos.length })
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

    addLog('info', 'Checking approval authorization', {
      approverId: req.userId,
      senderDepartmentName: sender.department,
      senderDepartmentId,
      senderSubDept: sender.department2
    })

    let isAuthorizedApprover = false

    if (approvers && typeof approvers === 'object') {
      for (const approver of Object.values(approvers)) {
        if (approver.approverId === req.userId && 
            approver.departmentId === senderDepartmentId &&
            (!approver.subDepartmentId || approver.subDepartmentId === sender.department2)) {
          isAuthorizedApprover = true
          addLog('info', 'Approver authorized', { approverId: req.userId, memoId })
          break
        }
      }
    }

    if (!isAuthorizedApprover) {
      addLog('warn', 'Unauthorized approval attempt', { 
        userId: req.userId, 
        memoId,
        senderDepartmentId,
        senderSubDept: sender.department2
      })
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

    // Send to recipient (LINE follower or system user)
    const recipientId = memoData.recipientId || memoData.recipientUserId
    
    // If this is a LINE recipient (followerId exists), send LINE message
    if (memoData.followerId) {
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
                text: `Doc #: ${memoData.docNumber}`,
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
                  uri: "https://rmcmemorandum.up.railway.app/"
                },
                style: "primary",
                color: "#1a2740"
              }
            ]
          }
        }
      }

      try {
        addLog('info', 'Attempting to send LINE message to approved memo recipient', { followerId: memoData.followerId, memoId })
        await client.pushMessage(memoData.followerId, lineMessage)
        addLog('info', 'LINE message sent successfully to approved memo recipient', { followerId: memoData.followerId, memoId })
      } catch (err) {
        addLog('error', 'Failed to send LINE message on approval', { followerId: memoData.followerId, error: err.message })
      }
    }
    
    // Also handle system user recipient (if exists)
    if (memoData.recipientId) {
      const recipient = await firebase_get(`users/${memoData.recipientId}`)
      if (recipient) {
        // Add to received_memos
        const approvedMemo = {
          ...memoData,
          sentAt: memoData.sentAt,
          status: 'sent',
          approvalPending: false
        }
        
        await firebase_set(`received_memos/${memoData.recipientId}/${memoId}`, approvedMemo)
        addLog('info', 'Approved memo added to received_memos', { recipientUserId: memoData.recipientId, memoId })
        
        // Create notification
        const memoNotification = {
          id: `${Date.now()}${Math.random().toString(36).substr(2, 9)}`,
          memoId: memoId,
          memoObject: approvedMemo,
          memoType: 'received',
          message: `"${memoData.title}" จาก ${senderUser.name} ${senderUser.surname}`,
          read: false,
          recipientId: memoData.recipientId,
          senderId: memoSenderId,
          timestamp: new Date().toISOString(),
          title: 'ได้รับ Memo ใหม่',
          type: 'info'
        }
        
        await firebase_set(`notifications/${memoData.recipientId}/${memoNotification.id}`, memoNotification)
        addLog('info', 'Notification created for approved memo', { recipientUserId: memoData.recipientId, notificationId: memoNotification.id })
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
      addLog('warn', 'Failed to create approval notification', { error: err.message })
    }

    addLog('info', 'Memo approved and sent to recipient', { approverId: req.userId, memoId, senderId: memoSenderId, recipientId })
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

    if (!reason) {
      return res.status(400).json({ error: "Rejection reason required" })
    }

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

    addLog('info', 'Checking rejection authorization', {
      rejectorId: req.userId,
      senderDepartmentName: sender.department,
      senderDepartmentId,
      senderSubDept: sender.department2
    })

    let isAuthorizedApprover = false

    if (approvers && typeof approvers === 'object') {
      for (const approver of Object.values(approvers)) {
        if (approver.approverId === req.userId && 
            approver.departmentId === senderDepartmentId &&
            (!approver.subDepartmentId || approver.subDepartmentId === sender.department2)) {
          isAuthorizedApprover = true
          addLog('info', 'Rejector authorized', { rejectorId: req.userId, memoId })
          break
        }
      }
    }

    if (!isAuthorizedApprover) {
      addLog('warn', 'Unauthorized rejection attempt', { 
        userId: req.userId, 
        memoId,
        senderDepartmentId,
        senderSubDept: sender.department2
      })
      return res.status(403).json({ error: "You are not authorized to reject this memo" })
    }

    // Update memo status
    memoData.status = 'rejected'
    memoData.approvalPending = false
    memoData.rejectedBy = req.userId
    memoData.rejectedByName = `${currentUser.name} ${currentUser.surname}`
    memoData.rejectedAt = new Date().toISOString()
    memoData.rejectionReason = reason

    await firebase_set(`sent_memos/${memoSenderId}/${memoId}`, memoData)

    // Notify sender
    const notification = {
      id: Date.now().toString(),
      title: 'Memo ถูกปฏิเสธ',
      message: `"${memoData.title}" ถูกปฏิเสธโดย ${currentUser.name} ${currentUser.surname}: ${reason}`,
      type: 'rejected',
      read: false,
      timestamp: new Date().toISOString(),
      memoId: memoId,
      memo: memoData
    }

    try {
      await firebase_set(`notifications/${memoSenderId}/${notification.id}`, notification)
    } catch (err) {
      addLog('warn', 'Failed to create rejection notification', { error: err.message })
    }

    addLog('info', 'Memo rejected', { approverId: req.userId, memoId, reason })
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
    addLog('info', 'User tab access updated', { adminId: req.userId, userId, tabs })
    
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
        : ['dashboard', 'compose', 'sent-memos', 'received-memos', 'followers']
      
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
        
        tabAccessList.push({
          userId,
          username: user.username,
          name: `${user.name} ${user.surname}`,
          role: user.role || 'user',
          tabs: userTabAccess?.tabs || ['N/A'],
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
        
        await firebase_set(`followers/${userId}`, {
          userId: userId,
          displayName: profile.displayName || 'Unknown',
          pictureUrl: profile.pictureUrl || null,
          statusMessage: profile.statusMessage || null,
          followedAt: new Date().toISOString(),
          status: 'active'
        })
        addLog('info', 'followers follow', { userId, displayName: profile.displayName })
      } catch (fbErr) {
        // Silent error handling
      }
    }

    // เมื่อมีคนกด unfollow
    if (event.type === 'unfollow') {
      const userId = event.source.userId
      try {
        await firebase_delete(`followers/${userId}`)
        addLog('info', 'followers unfollow', { userId })
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
    res.status(500).json({ error: err.message })
  }
})

// Get sent memos for current user
app.get("/sent-memos", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    addLog('info', 'Fetching sent memos', { userId })
    
    const sentMemos = await firebase_get(`sent_memos/${userId}`)
    
    if (!sentMemos || typeof sentMemos !== 'object') {
      addLog('info', 'Get sent memos - empty', { userId })
      return res.json({ memos: [], count: 0 })
    }
    
    // Convert to array and sort by sentAt descending (newest first)
    const memosArray = Object.values(sentMemos)
    memosArray.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
    
    // Enrich each memo with recipient name
    for (let memo of memosArray) {
      try {
        // Handle system user recipient (recipientUserId)
        if (memo.recipientUserId) {
          const recipientUser = await firebase_get(`users/${memo.recipientUserId}`)
          if (recipientUser) {
            memo.recipientName = `${recipientUser.name} ${recipientUser.surname}`
          }
        }
        // Handle LINE follower recipient (recipientId) - find which user linked this follower
        else if (memo.recipientId) {
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
        // Could not find recipient info
      }
    }
    
    addLog('info', 'Sent memos retrieved successfully', { userId, count: memosArray.length })
    res.json({ memos: memosArray, count: memosArray.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Get received memos for current user (memos sent to this user's linked followers)
app.get("/received-memos", verifyToken, async (req, res) => {
  try {
    const userId = req.userId
    addLog('info', 'Fetching received memos', { userId })
    
    // Get current user to access linked followers
    const currentUser = await firebase_get(`users/${userId}`)
    
    const linkedFollowerIds = currentUser?.linkedFollowers ? Object.keys(currentUser.linkedFollowers) : []
    
    // Get all users' sent memos to find ones sent to this user's followers
    const allUsers = await firebase_get('users')
    
    const receivedMemos = []
    
    // 1. Search through all users' sent_memos for memos sent to this user's followers
    if (allUsers && typeof allUsers === 'object' && linkedFollowerIds.length > 0) {
      for (let senderId in allUsers) {
        const senderMemos = await firebase_get(`sent_memos/${senderId}`)
        if (!senderMemos || typeof senderMemos !== 'object') continue
        
        // Check each memo - if it was sent to one of this user's followers, include it
        for (let memoId in senderMemos) {
          const memo = senderMemos[memoId]
          if (linkedFollowerIds.includes(memo.recipientId)) {
            // Enrich with sender info
            const sender = allUsers[senderId]
            if (sender) {
              memo.senderName = `${sender.name} ${sender.surname}`
              memo.senderUserId = senderId
            }
            receivedMemos.push(memo)
          }
        }
      }
    }
    
    // 2. Get memos sent directly to this system user (from received_memos collection)
    const directReceivedMemos = await firebase_get(`received_memos/${userId}`)
    if (directReceivedMemos && typeof directReceivedMemos === 'object') {
      for (let memoId in directReceivedMemos) {
        const memo = directReceivedMemos[memoId]
        receivedMemos.push(memo)
      }
    }
    
    // Sort by sentAt descending (newest first)
    receivedMemos.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
    
    addLog('info', 'Received memos retrieved successfully', { userId, count: receivedMemos.length })
    res.json({ memos: receivedMemos, count: receivedMemos.length })
  } catch (err) {
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
    res.status(500).json({ error: err.message })
  }
})

// Send notification to a specific user (admin only)
app.post("/notifications/send/:targetUserId", verifyToken, async (req, res) => {
  try {
    const { title, message, type, memoObject, memoType } = req.body
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
      memoObject: memoObject || null,
      memoType: memoType || null
    }
    
    await firebase_set(`notifications/${targetUserId}/${notificationId}`, notification)
    addLog('info', 'Notification sent to user', { targetUserId, senderUserId, notificationId })
    
    res.json({ status: 'Notification sent', notification })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Send memo to a system user (for users without linked followers)
app.post("/send-system-memo", verifyToken, async (req, res) => {
  try {
    const { targetUserId, title, type, content, docNumber } = req.body
    const senderUserId = req.userId
    
    if (!targetUserId || !title || !type || !content) {
      return res.status(400).json({ error: 'targetUserId, title, type, and content required' })
    }
    
    // Get sender info
    const sender = await firebase_get(`users/${senderUserId}`)
    if (!sender) {
      return res.status(404).json({ error: 'Sender not found' })
    }
    
    // Get recipient info
    const recipient = await firebase_get(`users/${targetUserId}`)
    if (!recipient) {
      return res.status(404).json({ error: 'Recipient not found' })
    }
    
    // Create memo ID
    const memoId = `memo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Create memo data
    const memoData = {
      memoId,
      title,
      type,
      content,
      docNumber: docNumber || '',
      senderUserId,
      senderName: `${sender.name} ${sender.surname}`,
      senderUsername: sender.username,
      recipientUserId: targetUserId,
      sentAt: new Date().toISOString(),
      status: 'pending',
      approvalPending: true,
      approvalChain: []
    }

    // Check if memo requires approval based on sender's department
    let memoApprovers = []
    const senderName = `${sender.name} ${sender.surname}`

    addLog('info', 'Checking approvers for system memo', { 
      senderUserId, 
      senderDepartmentName: sender?.department,
      senderSubDepartmentName: sender?.department2 
    })

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

      addLog('info', 'Department conversion (system memo)', { 
        departmentName: sender.department,
        departmentId: senderDepartmentId
      })

      const approvers = await firebase_get('memoApprovers')

      if (approvers && typeof approvers === 'object') {
        for (const [approverKey, approver] of Object.entries(approvers)) {
          // Check if approver can approve for this department
          if (approver.departmentId === senderDepartmentId) {
            // Either approves entire department or this specific sub-department
            const subDeptMatch = !approver.subDepartmentId ? true : (approver.subDepartmentId === sender.department2)
            
            if (subDeptMatch) {
              addLog('info', 'Approver matched (system memo)', { approverKey, approverId: approver.approverId })
              memoApprovers.push({
                approverId: approver.approverId,
                approverName: approver.approverName,
                approverUsername: approver.approverUsername
              })
            }
          }
        }
      }
    } else {
      addLog('info', 'Sender has no department assigned (system memo)', { senderUserId, senderDepartment: sender?.department })
    }

    addLog('info', 'Approvers check complete (system memo)', { memoApprovers: memoApprovers.length > 0 ? 'Found' : 'Not found', count: memoApprovers.length })

    // If approvers found, require approval before sending
    if (memoApprovers.length > 0) {
      memoData.requiresApproval = true
      memoData.approvers = memoApprovers
      memoData.status = 'pending_approval'
      
      // Store pending memo (NOT SENT YET)
      await firebase_set(`sent_memos/${senderUserId}/${memoId}`, memoData)
      
      // Create notifications for approvers ONLY - do NOT send to recipient yet
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
          recipientId: targetUserId
        }
        
        try {
          await firebase_set(`notifications/${approver.approverId}/${notification.id}`, notification)
          addLog('info', 'Approval notification sent to approver (system memo)', { approverId: approver.approverId, memoId, senderUserId, recipientId: targetUserId })
        } catch (err) {
          addLog('warn', 'Failed to send approval notification (system memo)', { approverId: approver.approverId, error: err.message })
        }
      }

      addLog('info', 'System memo created - pending approval', { memoId, senderId: senderUserId, recipientId: targetUserId, approverCount: memoApprovers.length })
      return res.json({ status: "Memo created - pending approval", memoId, approverCount: memoApprovers.length })
    }

    // No approvers found - send directly to recipient
    memoData.status = 'sent'
    memoData.approvalPending = false
    memoData.sentTime = new Date().toISOString()

    // Store in sender's sent_memos
    await firebase_set(`sent_memos/${senderUserId}/${memoId}`, memoData)
    
    // Store in recipient's received_memos
    await firebase_set(`received_memos/${targetUserId}/${memoId}`, memoData)

    // Create notification for recipient
    const notification = {
      id: Date.now().toString(),
      title: 'ได้รับ Memo ใหม่',
      message: `"${title}" จาก ${senderName}`,
      type: 'info',
      read: false,
      timestamp: new Date().toISOString(),
      memoId: memoId,
      memoObject: memoData,
      memoType: 'received',
      senderId: senderUserId,
      recipientId: targetUserId
    }
    
    await firebase_set(`notifications/${targetUserId}/${notification.id}`, notification)

    addLog('info', 'System memo sent successfully (direct - no approval needed)', { senderUserId, targetUserId, memoId, docNumber })
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
    
    addLog('info', 'Notification marked as read', { userId, notificationId })
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
    addLog('info', 'Notification deleted', { userId, notificationId })
    
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
    addLog('info', 'All notifications deleted', { userId })
    
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
      for (const [key, approver] of Object.entries(approvers)) {
        const isMatch = approver.departmentId === sender.department
        const subDeptMatch = !approver.subDepartmentId ? true : (approver.subDepartmentId === sender.department2)
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