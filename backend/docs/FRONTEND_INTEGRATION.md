# Frontend Integration Guide

This document defines the data contracts and integration points between the Brandon Frontend (web app) and Backend (SMS service).

## Overview

Both frontend and backend share the same Supabase database but serve different purposes:

- **Frontend:** User onboarding, profile management, workout planning, subscription management
- **Backend:** SMS messaging, AI coaching, daily reminders

**Shared Database:** shared Supabase project (used by both the web app and this backend)

---

## Shared Tables

### users

The backend **reads** from this table to validate subscriptions.

**Critical Fields for Backend:**

| Field | Type | Required | Backend Usage | Frontend Responsibility |
|-------|------|----------|---------------|------------------------|
| id | varchar | Yes | User identification | Set during signup (UUID or Supabase auth ID) |
| subscription_status | varchar | **Yes** | Subscription validation | Update from Stripe webhooks |
| created_at | timestamp | Yes | - | Set on user creation |

**subscription_status Values:**

Backend accepts these as valid:
- `"active"` - User can receive messages ✅
- `"trialing"` - User can receive messages ✅
- `"past_due"` - User can receive messages (grace period) ✅

Backend rejects:
- `"canceled"` - Subscription ended ❌
- `"incomplete"` - Payment pending ❌
- `"incomplete_expired"` - Payment failed ❌
- `null` or missing - No subscription ❌

**Frontend Must:**
1. Set `subscription_status = 'active'` when subscription starts
2. Update status from Stripe webhooks in real-time
3. Ensure status values exactly match expected strings (case-sensitive)

---

### profiles

The backend **reads** from this table to:
1. Look up users by phone number
2. Build AI context (name, goal, equipment, etc.)
3. Schedule daily messages

**Critical Fields for Backend:**

| Field | Type | Required | Format/Constraints | Backend Usage |
|-------|------|----------|-------------------|---------------|
| user_id | varchar | Yes | Must match users.id | Link to user account |
| name | text | **Yes** | User's first name | Personalize AI responses |
| phone | text | **Yes** | **E.164 format** | User lookup, message routing |
| goal | text | **Yes** | - | AI context, motivation |
| experience | text | No | - | AI context |
| equipment | jsonb | No | Array of strings | AI workout context |
| split | text | No | - | AI workout context |
| workout_days | jsonb | No | Array of day names | Schedule awareness |
| preferred_text_time | text | **Yes** | **"HH:MM" or "HH:MM:SS"** | Daily message scheduling |

**Phone Number Format (CRITICAL):**

```javascript
// ✅ CORRECT - E.164 format
"+15555550100"  // US number
"+447123456789" // UK number
"+61412345678"  // Australia

// ❌ WRONG - Will break backend
"(555) 555-0100"
"555-555-0100"
"5555550100"
"+1 256 509 4290"
```

**E.164 Format Rules:**
- Always starts with `+`
- Country code + area code + number (no spaces/dashes)
- No special characters except leading `+`
- Typical length: 10-15 digits (varies by country)

**Validation (JavaScript):**
```javascript
function isValidE164(phone) {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}
```

**Frontend Must:**
1. Store phone numbers in E.164 format ONLY
2. Convert user input to E.164 before saving
3. Validate format before saving to database
4. Display formatted (with dashes) but store E.164

**preferred_text_time Format:**

```javascript
// ✅ CORRECT
"09:00"     // 9:00 AM
"14:30"     // 2:30 PM
"18:00:00"  // 6:00 PM (with seconds)

// ❌ WRONG
"9am"
"2:30pm"
"14:30 PM"
```

**Frontend Must:**
1. Store in 24-hour format ("HH:MM" or "HH:MM:SS")
2. Validate hours (0-23) and minutes (0-59)
3. Can display in 12-hour format to user, but store 24-hour

---

### workout_plans

The backend **reads** from this table to build AI context about the user's workouts.

**Critical Fields for Backend:**

| Field | Type | Required | Backend Usage |
|-------|------|----------|---------------|
| user_id | varchar | Yes | Fetch user's active plan |
| plan_data | **jsonb** | Yes | Extract today's workout |
| status | text | Yes | Only uses 'active' plans |

**plan_data Structure:**

The backend expects this JSONB structure (flexible, but recommended):

```json
{
  "split": "Upper/Lower",
  "days": [
    {
      "day": "Monday",
      "focus": "Upper Body",
      "exercises": [
        {
          "name": "Bench Press",
          "sets": 4,
          "reps": "8-10",
          "rest": "90 seconds",
          "notes": "Focus on form"
        },
        {
          "name": "Dumbbell Rows",
          "sets": 4,
          "reps": "10-12"
        }
      ]
    },
    {
      "day": "Tuesday",
      "focus": "Rest"
    },
    {
      "day": "Wednesday",
      "focus": "Lower Body",
      "exercises": [...]
    }
  ]
}
```

**Required Fields in plan_data:**
- `days` (array) - List of workout days
- `days[].day` (string) - Day name ("Monday", "Tuesday", etc.)
- `days[].focus` (string) - Workout focus or "Rest"
- `days[].exercises` (array, optional) - List of exercises

**Day Names Must Match:**
```
"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
```
(Case-sensitive, must be full day name)

**Frontend Must:**
1. Create plan_data with `days` array
2. Use full day names ("Monday", not "Mon")
3. Include `focus` for each day
4. Set `status = 'active'` for current plan

**Backend Behavior:**
- Extracts today's day name (e.g., "Wednesday")
- Searches plan_data.days for matching day
- Uses `focus` and `exercises` in AI context
- Falls back gracefully if structure differs

---

### workout_sessions

The backend **may read** from this table in the future for recent activity context.

Currently not used, but keep this structure consistent for future use.

---

## Backend Tables

These tables are **created and managed by the backend**. Frontend can optionally display this data.

### messages

**Purpose:** Full SMS conversation history

**Schema:**
```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id),
  phone_number TEXT,
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  content TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Frontend Use Cases:**
- Display conversation history in user dashboard
- Show message analytics
- Support ticket context

**Query Example:**
```sql
-- Get recent messages for a user
SELECT * FROM messages
WHERE user_id = 'user_123'
ORDER BY created_at DESC
LIMIT 50;
```

---

### scheduled_messages

**Purpose:** Daily message queue

**Schema:**
```sql
CREATE TABLE scheduled_messages (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR REFERENCES users(id),
  phone_number TEXT,
  scheduled_time TIMESTAMP,
  message_content TEXT,
  status TEXT CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**Frontend Use Cases:**
- Show upcoming daily messages
- Display message delivery status
- Allow users to pause/resume daily messages

---

## Integration Checklist

### During User Onboarding

**Frontend Responsibilities:**

- [ ] Create user in `users` table (via Supabase Auth or custom)
- [ ] Set `subscription_status = 'active'` after payment
- [ ] Create profile in `profiles` table
- [ ] **Save phone number in E.164 format**
- [ ] Set `preferred_text_time` (validate HH:MM format)
- [ ] Create initial workout plan in `workout_plans`
- [ ] Ensure `plan_data` has correct structure

**Validation Before Saving:**

```javascript
// Phone validation
if (!isValidE164(phoneNumber)) {
  throw new Error("Invalid phone number format");
}

// Time validation
if (!/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/.test(preferredTime)) {
  throw new Error("Invalid time format. Use HH:MM");
}

// Day validation
const validDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
for (const day of workoutPlan.days) {
  if (!validDays.includes(day.day)) {
    throw new Error(`Invalid day name: ${day.day}`);
  }
}
```

---

### Subscription Management

**Stripe Webhook Handler (Frontend):**

When subscription status changes:

```javascript
// Example: Stripe webhook handler
async function handleSubscriptionUpdated(subscription) {
  const userId = subscription.metadata.user_id;
  const status = subscription.status; // 'active', 'canceled', etc.

  // Update users table
  await supabase
    .from('users')
    .update({ subscription_status: status })
    .eq('id', userId);

  // If canceled, optionally notify user via email
  if (status === 'canceled') {
    await sendCancellationEmail(userId);
  }
}
```

**Status Mapping:**

| Stripe Status | Save to DB | Backend Access |
|---------------|------------|----------------|
| `active` | `"active"` | ✅ Yes |
| `trialing` | `"trialing"` | ✅ Yes |
| `past_due` | `"past_due"` | ✅ Yes (grace period) |
| `canceled` | `"canceled"` | ❌ No |
| `incomplete` | `"incomplete"` | ❌ No |
| `incomplete_expired` | `"incomplete_expired"` | ❌ No |
| `unpaid` | `"unpaid"` | ❌ No |

---

### Profile Updates

When user updates profile (phone, preferred time, etc.):

**Frontend:**
```javascript
async function updateUserProfile(userId, updates) {
  // Validate phone if updated
  if (updates.phone && !isValidE164(updates.phone)) {
    throw new Error("Phone must be in E.164 format (+1234567890)");
  }

  // Validate time if updated
  if (updates.preferred_text_time && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(updates.preferred_text_time)) {
    throw new Error("Time must be in HH:MM format (24-hour)");
  }

  // Update profile
  await supabase
    .from('profiles')
    .update(updates)
    .eq('user_id', userId);
}
```

**Important:** Phone number changes take effect immediately. User will receive messages at new number.

---

## Phone Number Best Practices

### Collection

**Input Field:**
```html
<input
  type="tel"
  placeholder="+1 (555) 555-0100"
  pattern="^\+[1-9]\d{1,14}$"
  required
/>
```

**Frontend Processing:**
```javascript
import { parsePhoneNumber } from 'libphonenumber-js';

function normalizePhoneNumber(input, defaultCountry = 'US') {
  try {
    const phoneNumber = parsePhoneNumber(input, defaultCountry);

    if (!phoneNumber.isValid()) {
      throw new Error("Invalid phone number");
    }

    // Returns E.164 format (e.g., "+15555550100")
    return phoneNumber.format('E.164');
  } catch (error) {
    throw new Error("Unable to parse phone number");
  }
}

// Usage
const userInput = "(555) 555-0100";
const e164Phone = normalizePhoneNumber(userInput, 'US');
// Result: "+15555550100"
```

**Recommended Library:** `libphonenumber-js`
```bash
npm install libphonenumber-js
```

### Display

**Show formatted to user, store E.164:**

```javascript
import { parsePhoneNumber } from 'libphonenumber-js';

function displayPhoneNumber(e164Phone) {
  const phoneNumber = parsePhoneNumber(e164Phone);
  return phoneNumber.formatNational(); // "(555) 555-0100"
}

// Storage: "+15555550100"
// Display: "(555) 555-0100"
```

---

## Testing Integration

### Test User Setup

Create a test user with all required fields:

```javascript
const testUser = {
  // users table
  id: "test_user_123",
  email: "test@example.com",
  subscription_status: "active", // ✅ Valid
  created_at: new Date().toISOString()
};

const testProfile = {
  // profiles table
  user_id: "test_user_123",
  name: "John",
  phone: "+15555550100", // ✅ E.164 format
  goal: "Build muscle",
  experience: "intermediate",
  equipment: ["dumbbells", "barbell", "bench"],
  split: "Push/Pull/Legs",
  workout_days: ["Monday", "Wednesday", "Friday"],
  preferred_text_time: "09:00", // ✅ HH:MM format
  created_at: new Date().toISOString()
};

const testWorkoutPlan = {
  // workout_plans table
  user_id: "test_user_123",
  plan_data: {
    split: "Push/Pull/Legs",
    days: [
      {
        day: "Monday", // ✅ Full day name
        focus: "Push",
        exercises: [
          { name: "Bench Press", sets: 4, reps: "8-10" },
          { name: "Shoulder Press", sets: 3, reps: "10-12" }
        ]
      },
      // ... other days
    ]
  },
  status: "active",
  created_at: new Date().toISOString()
};
```

### Validation Test

```javascript
async function testBackendIntegration() {
  // 1. Create test user in Supabase
  await createTestUser(testUser, testProfile, testWorkoutPlan);

  // 2. Send test SMS from +15555550100 to Mac server
  // (Mac will forward to backend)

  // 3. Verify backend response in messages table
  const messages = await supabase
    .from('messages')
    .select('*')
    .eq('user_id', 'test_user_123')
    .order('created_at', { ascending: false })
    .limit(2);

  console.log('Inbound:', messages[1]); // User's message
  console.log('Outbound:', messages[0]); // AI response

  // 4. Verify scheduled message created
  const scheduled = await supabase
    .from('scheduled_messages')
    .select('*')
    .eq('user_id', 'test_user_123')
    .eq('status', 'pending')
    .single();

  console.log('Scheduled for:', scheduled.scheduled_time);
}
```

---

## Common Issues & Solutions

### Issue: "User not found" error

**Cause:** Phone number not in E.164 format or doesn't match database

**Solution:**
1. Check profiles table: `SELECT phone FROM profiles WHERE user_id = '...'`
2. Verify format: Must start with `+` and contain only digits
3. Update if needed: `UPDATE profiles SET phone = '+15555550100' WHERE user_id = '...'`

### Issue: "Subscription inactive" error

**Cause:** subscription_status not in valid set

**Solution:**
1. Check users table: `SELECT subscription_status FROM users WHERE id = '...'`
2. Valid values: `'active'`, `'trialing'`, `'past_due'`
3. Update: `UPDATE users SET subscription_status = 'active' WHERE id = '...'`

### Issue: Daily messages not sending

**Cause:** preferred_text_time not set or invalid format

**Solution:**
1. Check profiles table: `SELECT preferred_text_time FROM profiles WHERE user_id = '...'`
2. Must be "HH:MM" format (24-hour)
3. Update: `UPDATE profiles SET preferred_text_time = '09:00' WHERE user_id = '...'`

### Issue: AI doesn't know about workout

**Cause:** plan_data structure doesn't match expected format

**Solution:**
1. Check workout_plans: `SELECT plan_data FROM workout_plans WHERE user_id = '...' AND status = 'active'`
2. Ensure has `days` array with `day`, `focus`, `exercises` fields
3. Day names must be full ("Monday", not "Mon")

---

## Support

For integration questions or issues:

1. Verify data formats (E.164 phone, HH:MM time, full day names)
2. Check Supabase tables for required fields
3. Review backend logs for validation errors
4. Test with curl to backend /mac/webhook endpoint
5. Consult [API.md](API.md) for webhook format

---

## Future Enhancements

Potential future integration points:

- **Message History Display:** Show SMS conversation in frontend
- **Message Pause/Resume:** Allow users to temporarily disable daily messages
- **Custom Schedules:** Multiple daily messages at different times
- **Conversation Export:** Download message history
- **Analytics:** Message engagement metrics
