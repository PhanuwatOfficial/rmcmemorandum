# Translation Implementation Guide

## ✅ COMPLETED

### 1. Updated Translations Object
Added **120+ new translation keys** to the translations object in index.html (lines 5101-5400):

**Thai (th) and English (en) translations added for:**
- Login/Register: welcomeToMemo, enterUsername, enterPassword, signIn, dontHaveAccount, registerHere
- Register: createAccount, joinSystem, firstName, lastName, chooseUsername, firstNamePlaceholder, lastNamePlaceholder, createPassword, confirmYourPassword, departmentTh, selectDepartment, subDepartmentTh, selectSubDepartment, createAccountBtn, alreadyHaveAccount, loginHere
- Account Management: accountSettings, manageAccountFollowers, accountInformation, currentPassword, updatePassword, clear, changePassword, linkedLINEProfile, refresh, noLINEProfile, linkProfile
- Dashboard: executiveInbox, manageLINE, memoSent, allMemosDispatched, pendingApprovals, awaitingYourDecision, memosReceived, sentToFollowers, approved, successfullyApproved, quickActions, composeMemorandum, broadcastToAll, viewFollowers, viewLogs, recentActivity
- Compose: createAndDispatch, memoDetails, documentNumber, memoTitle, enterMemoTitle, memoType, filterByDepartment, recipients, selectRecipients, messageBody, typeContent, attachImage, clickToUpload, sendMemorandum
- Views: sentMemos, reviewDispatched, memoHistory, date, docNumber, title, type, recipient, status, preview, action, noSentMemos, receivedMemos, viewMemosFollowers, incomingMemos, from, noReceivedMemos
- More: pendingMemoApprovals, reviewAndApprove, memosAwaitingApproval, to, noPendingApprovals, broadcastMemorandum, dispatchMessage, massDispatch, broadcastMessage, broadcastContent, broadcastAllFollowers, followerRegistry, manageReview, systemUsers, totalUsersInSystem, lineFollowers, activeLINEFollowers, linkedUsers, usersWithLinkedFollowers, pendingUsers, usersAwaitingApproval, roleColumn, joinedColumn, passwordColumn

### 2. Added data-translate Attributes to HTML Elements

#### ✅ Login Form
- Page header & welcome message
- Username label & input field
- Password label & input field
- "Sign In" button
- "Don't have an account?" text
- "Register here" link

#### ✅ Register Form
- Page header & description
- Username field
- First Name field
- Last Name field
- Password field
- Confirm Password field
- Department (ฝ่าย) dropdown
- Sub-Department (แผนก) dropdown
- "Create Account" button
- "Already have an account?" text
- "Login here" link

#### ✅ Account Settings View
- Page header & description
- Account Information section title
- Change Password section title
- Current Password label
- New Password label
- Confirm Password label
- Update Password button
- Clear button
- Linked LINE Profile section title
- Refresh button
- "No LINE Profile Linked" message

#### ✅ Dashboard View
- Page header & description
- All stat cards (Memo Sent, Pending Approvals, Memos Received, Approved)
- Quick Actions section title
- All action buttons (Compose, Broadcast, View Followers, View Logs)
- Recent Activity section title

#### ✅ Compose Memorandum View (Partial)
- Page header & description
- Memorandum Details section title
- Memo Title field
- Memo Type label

## ⏳ REMAINING WORK

The following sections still need `data-translate` attributes added:

### Views Needing Translation Keys
1. **Compose View** (continued)
   - Filter by Department dropdown
   - Recipients selection
   - Message Body textarea
   - Attach Image button
   - Send Memorandum button
   - Clear button
   - Status messages

2. **Sent Memos View**
   - Page header
   - Section header & count badge
   - Refresh button
   - Table headers (Date, DocNumber, Title, Type, Recipient, Status, Preview, Action)
   - Empty state message
   - Action buttons (View, Delete, etc.)

3. **Received Memos View**
   - Page header
   - Section header & count badge
   - Table headers
   - Empty state message

4. **Pending Approvals View**
   - Page header
   - Section header & count badge
   - Table headers
   - Empty state message
   - Approve/Reject buttons

5. **Broadcast View**
   - Page header
   - Section header
   - Message textarea label & placeholder
   - Broadcast button
   - Clear button
   - Status messages

6. **Followers Management View**
   - Page header
   - All stat cards (System Users, LINE Followers, Linked Users, Pending Users)
   - Pending User Registrations section
   - System Users section
   - Active Followers section
   - All Linked Followers section
   - Link New Follower form
   - Admin Navigation section (Permissions, Memo Approvers, Tab Access Control)
   - Department Management section
   - Department Structure section
   - Table headers and labels throughout

## Implementation Pattern

All `data-translate` attributes use the following pattern:

```html
<!-- For labels/headings -->
<label data-translate="translationKey">English Text</label>
<h2 data-translate="translationKey">Heading Text</h2>

<!-- For buttons -->
<button data-translate="translationKey">Button Text</button>

<!-- For inputs/textareas (uses placeholder or label) -->
<input placeholder="..." data-translate="translationKey">
<textarea data-translate="translationKey"></textarea>
```

## Translation System

The `applyTranslations()` function (lines 5220-5245) handles:
1. Finding all elements with `data-translate` attribute
2. Getting the translation key from the attribute
3. Looking up the text in the `translations` object for the current language
4. Setting the text appropriately:
   - Input/Textarea: Sets placeholder text
   - Label: Sets text content
   - Other elements: Sets text content (preserves icons)

## Next Steps

To complete the translation implementation:

1. Add remaining translation keys to the `translations` object (th and en) for all the sections listed above
2. Add `data-translate` attributes to all remaining HTML elements in those sections
3. Test language switching to ensure all elements update correctly
4. Verify placeholder text updates for input fields
5. Test on both desktop and mobile views

## File Locations

- Main HTML file: `c:\Users\mtw-en01\Desktop\line\public\index.html`
- Translations object: Lines 5101-5400
- applyTranslations() function: Lines 5220-5245
- Language switching functions: Lines 5193-5217
