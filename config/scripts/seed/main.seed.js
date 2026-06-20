const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const prisma = new PrismaClient();

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN(arr, n) { return [...arr].sort(() => 0.5 - Math.random()).slice(0, n); }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return parseFloat((Math.random() * (max - min) + min).toFixed(2)); }
function futureDate(daysAhead) { return new Date(Date.now() + daysAhead * 86400000); }
function pastDate(daysAgo) { return new Date(Date.now() - daysAgo * 86400000); }
function hoursAgo(h) { return new Date(Date.now() - h * 3600000); }

async function main() {
  console.log("🚀 Starting Comprehensive Database Seeding...\n");

  try {
    // ═══════════════════════════════════════════════════════════
    // 1. USERS (31 total)
    // ═══════════════════════════════════════════════════════════
    console.log("👥 Creating Users...");
    const plainPw = "Password123!";
    const salt = await bcrypt.genSalt(10);
    const hp = await bcrypt.hash(plainPw, salt);

    const userData = [
      { email: "admin@carenexus.com", username: "Admin User", role: "admin", gender: "male", addr: "Smart Village, Cairo" },
      { email: "dr.ahmed@carenexus.com", username: "Dr. Ahmed Hassan", role: "doctor", gender: "male", spec: "Cardiology", addr: "Nasr City, Cairo" },
      { email: "dr.sara@carenexus.com", username: "Dr. Sara Mahmoud", role: "doctor", gender: "female", spec: "Pediatrics", addr: "Maadi, Cairo" },
      { email: "dr.omar@carenexus.com", username: "Dr. Omar Farouk", role: "doctor", gender: "male", spec: "Neurology", addr: "Zamalek, Cairo" },
      { email: "dr.fatma@carenexus.com", username: "Dr. Fatma El-Sayed", role: "doctor", gender: "female", spec: "Dermatology", addr: "Heliopolis, Cairo" },
      { email: "dr.khaled@carenexus.com", username: "Dr. Khaled Nasser", role: "doctor", gender: "male", spec: "Orthopedics", addr: "Mohandessin, Giza" },
      { email: "dr.nadia@carenexus.com", username: "Dr. Nadia Hossam", role: "doctor", gender: "female", spec: "Gynecology", addr: "New Cairo" },
      { email: "dr.youssef@carenexus.com", username: "Dr. Youssef Adel", role: "doctor", gender: "male", spec: "Internal Medicine", addr: "6th October City" },
      { email: "dr.mariam@carenexus.com", username: "Dr. Mariam Tarek", role: "doctor", gender: "female", spec: "Psychiatry", addr: "Dokki, Giza" },
      { email: "nurse.fatma@carenexus.com", username: "Fatma Ali", role: "nursing", gender: "female", spec: "Emergency", addr: "Ain Shams, Cairo" },
      { email: "nurse.mona@carenexus.com", username: "Mona Ibrahim", role: "nursing", gender: "female", spec: "ICU", addr: "Shubra, Cairo" },
      { email: "nurse.ahmed@carenexus.com", username: "Ahmed Saeed", role: "nursing", gender: "male", spec: "Surgical", addr: "Helwan, Cairo" },
      { email: "nurse.nour@carenexus.com", username: "Nour El-Din", role: "nursing", gender: "male", spec: "Home Care", addr: "Imbaba, Giza" },
      { email: "nurse.salma@carenexus.com", username: "Salma Osama", role: "nursing", gender: "female", spec: "Pediatric", addr: "Shoubra, Cairo" },
      { email: "patient.khaled@carenexus.com", username: "Khaled Mostafa", role: "patient", gender: "male", addr: "Madinaty, Cairo" },
      { email: "patient.nour@carenexus.com", username: "Nour El-Hassan", role: "patient", gender: "male", addr: "Rehab City" },
      { email: "patient.layla@carenexus.com", username: "Layla Ahmed", role: "patient", gender: "female", addr: "Katameya, Cairo" },
      { email: "patient.yousef@carenexus.com", username: "Yousef Samir", role: "patient", gender: "male", addr: "Sheraton, Cairo" },
      { email: "patient.mona@carenexus.com", username: "Mona Abdel-Rahman", role: "patient", gender: "female", addr: "Helmeyet El-Zaitoun" },
      { email: "patient.omar@carenexus.com", username: "Omar Tarek", role: "patient", gender: "male", addr: "Hadayek El-Kobba" },
      { email: "patient.sara@carenexus.com", username: "Sara Ibrahim", role: "patient", gender: "female", addr: "El-Matareya" },
      { email: "patient.ali@carenexus.com", username: "Ali Hassan", role: "patient", gender: "male", addr: "El-Salam City" },
      { email: "patient.hana@carenexus.com", username: "Hana Mohamed", role: "patient", gender: "female", addr: "El-Marg, Cairo" },
      { email: "patient.tarek@carenexus.com", username: "Tarek Nabil", role: "patient", gender: "male", addr: "Ain Shams" },
      { email: "patient.dina@carenexus.com", username: "Dina Adel", role: "patient", gender: "female", addr: "Manial, Cairo" },
      { email: "patient.amr@carenexus.com", username: "Amr Saeed", role: "patient", gender: "male", addr: "Garden City, Cairo" },
      { email: "pharmacy.helmy@carenexus.com", username: "Helmy Pharmacy", role: "pharmacy", gender: "male", addr: "Downtown Cairo" },
      { email: "pharmacy.shorouk@carenexus.com", username: "Shorouk Pharmacy", role: "pharmacy", gender: "female", addr: "Nasr City, Cairo" },
      { email: "pharmacy.nile@carenexus.com", username: "Nile Pharmacy", role: "pharmacy", gender: "male", addr: "Maadi, Cairo" },
      { email: "pharmacy.delta@carenexus.com", username: "Delta Pharmacy", role: "pharmacy", gender: "female", addr: "Zamalek, Cairo" },
      { email: "shipping.fast@carenexus.com", username: "FastShip Express", role: "shipping_company", gender: "male", addr: "Industrial Zone, Cairo" },
      { email: "shipping.care@carenexus.com", username: "CareDelivery Co.", role: "shipping_company", gender: "male", addr: "Smart Village, Cairo" },
      { email: "shipping.swift@carenexus.com", username: "SwiftLogistics", role: "shipping_company", gender: "male", addr: "6th October City" },
    ];

    const createdUsers = [];
    for (const u of userData) {
      const exist = await prisma.user.findFirst({ where: { email: u.email } });
      if (exist) { createdUsers.push(exist); continue; }
      const user = await prisma.user.create({
        data: {
          email: u.email,
          username: u.username,
          password: hp,
          role: u.role,
          phone: `+2010${randInt(10000000, 99999999)}`,
          country: "Egypt",
          address: u.addr,
          emailVerified: true,
          gender: u.gender,
          description: `${u.role} at CareNexus platform`,
          latitude: 30.0444 + randFloat(-0.05, 0.05),
          longitude: 31.2357 + randFloat(-0.05, 0.05),
          avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(u.username)}&backgroundColor=0088ff`,
          wallet: { create: { balance: randFloat(0, 500), remainingAccount: randFloat(0, 500) } },
          kyc: { create: { identityNumber: `ID-${Date.now()}-${randInt(1000, 9999)}`, documentation: true } },
        },
      });
      createdUsers.push(user);
      console.log(`  ✅ ${u.username} (${u.role})`);
    }

    const admins = createdUsers.filter(u => u.role === "admin");
    const doctors = createdUsers.filter(u => u.role === "doctor");
    const nurses = createdUsers.filter(u => u.role === "nursing");
    const patients = createdUsers.filter(u => u.role === "patient");
    const pharmacies = createdUsers.filter(u => u.role === "pharmacy");
    const shippings = createdUsers.filter(u => u.role === "shipping_company");
    const allProviders = [...doctors, ...nurses];
    const allNonAdmin = createdUsers.filter(u => u.role !== "admin");
    const admin = admins[0];

    // ═══════════════════════════════════════════════════════════
    // 2. CATEGORIES
    // ═══════════════════════════════════════════════════════════
    console.log("\n📂 Creating Categories...");
    const categoryData = [
      { text: "Health Tips", type: "blog", roles: ["doctor", "nursing"] },
      { text: "Medical News", type: "blog", roles: ["doctor"] },
      { text: "Patient Stories", type: "blog", roles: ["patient", "doctor"] },
      { text: "Nutrition", type: "blog", roles: ["doctor", "nursing"] },
      { text: "Mental Health", type: "blog", roles: ["doctor", "nursing"] },
      { text: "Medicine", type: "blog", roles: ["doctor"] },
      { text: "Medications", type: "product", roles: ["pharmacy"] },
      { text: "Medical Devices", type: "product", roles: ["pharmacy"] },
      { text: "Supplements", type: "product", roles: ["pharmacy"] },
      { text: "First Aid", type: "product", roles: ["pharmacy"] },
      { text: "Personal Care", type: "product", roles: ["pharmacy"] },
    ];
    const createdCategories = [];
    for (const c of categoryData) {
      const exist = await prisma.category.findFirst({ where: { text: c.text, type: c.type } });
      if (exist) { createdCategories.push(exist); continue; }
      const cat = await prisma.category.create({ data: { text: c.text, type: c.type, roles: c.roles, userId: admin.id } });
      createdCategories.push(cat);
      console.log(`  ✅ ${c.text} (${c.type})`);
    }
    const blogCats = createdCategories.filter(c => c.type === "blog");
    const ecomCats = createdCategories.filter(c => c.type === "product");

    // ═══════════════════════════════════════════════════════════
    // 3. FRIENDSHIPS (every user has 3-8 friends)
    // ═══════════════════════════════════════════════════════════
    console.log("\n👫 Creating Friendships...");
    let friendCount = 0;
    for (const user of createdUsers) {
      // Each user gets 3-8 random friends from other roles
      const potentialFriends = createdUsers.filter(u => u.id !== u.id).filter(u => {
        if (user.role === "patient") return u.role === "doctor" || u.role === "nursing" || u.role === "patient";
        if (user.role === "doctor") return u.role !== "admin";
        if (user.role === "nursing") return u.role !== "admin";
        if (user.role === "pharmacy") return u.role === "pharmacy" || u.role === "shipping_company";
        if (user.role === "shipping_company") return u.role === "pharmacy" || u.role === "shipping_company";
        return true;
      });
      const numFriends = randInt(3, Math.min(8, potentialFriends.length));
      const friends = pickN(potentialFriends, numFriends);
      for (const friend of friends) {
        try {
          await prisma.friendship.upsert({
            where: { requesterId_addresseeId: { requesterId: user.id, addresseeId: friend.id } },
            update: {},
            data: { requesterId: user.id, addresseeId: friend.id, status: "accepted" },
          });
          friendCount++;
        } catch (e) { /* skip duplicate */ }
      }
    }
    console.log(`  ✅ ${friendCount} friendships created`);

    // ═══════════════════════════════════════════════════════════
    // 4. POSTS (15 posts with likes & comments)
    // ═══════════════════════════════════════════════════════════
    console.log("\n📝 Creating Posts...");
    const postTitles = [
      "Understanding Heart Disease: A Complete Guide",
      "The Importance of Vaccination for Children",
      "10 Superfoods for Better Health",
      "Managing Stress in the Modern World",
      "New Breakthroughs in Cancer Treatment",
      "Understanding Diabetes: Type 1 vs Type 2",
      "Heart Attack Prevention Tips",
      "The Benefits of Regular Exercise",
      "Sleep Hygiene: How to Improve Your Sleep",
      "Understanding Blood Pressure Readings",
      "Childhood Obesity: Causes and Prevention",
      "Mental Health Awareness: Breaking the Stigma",
      "The Role of Nutrition in recovery",
      "Exercise After Surgery: What You Need to Know",
      "Understanding Allergies and Treatment Options",
    ];
    const createdPosts = [];
    for (let i = 0; i < postTitles.length; i++) {
      const author = pick(doctors.concat(nurses));
      const cat = pick(blogCats);
      if (!author || !cat) continue;
      try {
        const post = await prisma.post.create({
          data: {
            title: postTitles[i],
            description: `Comprehensive article about ${postTitles[i].toLowerCase()}. Written by ${author.username}. This article covers essential information, prevention strategies, and treatment options.`,
            category: cat.id,
            userId: author.id,
            allowComments: true,
            image: `https://picsum.photos/seed/post${i + 1}/800/400`,
          },
          include: { user: { select: { id: true, username: true, avatar: true } } },
        });
        createdPosts.push(post);

        // Likes from 3-12 random users
        const likers = pickN(allNonAdmin.filter(u => u.id !== author.id), randInt(3, 12));
        for (const liker of likers) {
          try {
            await prisma.postLike.upsert({
              where: { postId_userId: { postId: post.id, userId: liker.id } },
              create: { postId: post.id, userId: liker.id, reactionType: pick(["like", "heart", "haha", "wow"]) },
              update: {},
            });
          } catch (e) {}
        }

        // Comments from 2-6 random users
        const commenters = pickN(allNonAdmin.filter(u => u.id !== author.id), randInt(2, 6));
        const commentTexts = [
          "Great article! Very informative and well-written.",
          "Thank you for sharing this valuable information with us.",
          "This is exactly what I was looking for. Very helpful!",
          "Very well written. Keep up the excellent work!",
          "I learned so much from this post. Thanks a lot!",
          "Could you share more details about this specific topic?",
          "Excellent insights! This should be shared more widely.",
          "My patients will definitely benefit from this information.",
        ];
        for (const commenter of commenters) {
          try {
            const comment = await prisma.comment.create({
              data: {
                text: pick(commentTexts),
                postId: post.id,
                userId: commenter.id,
              },
            });
            // Comment likes
            const clikers = pickN(allNonAdmin.filter(u => u.id !== commenter.id), randInt(0, 3));
            for (const cl of clikers) {
              try { await prisma.commentLike.create({ data: { commentId: comment.id, userId: cl.id } }); } catch (e) {}
            }
          } catch (e) {}
        }
        console.log(`  ✅ "${postTitles[i]}" by ${author.username}`);
      } catch (e) { console.log(`  ⚠️  Post skipped: ${postTitles[i]}`); }
    }

    // ═══════════════════════════════════════════════════════════
    // 5. CHAT ROOMS & MESSAGES (every user has 2-5 chat rooms)
    // ═══════════════════════════════════════════════════════════
    console.log("\n💬 Creating Chat Rooms & Messages...");
    const chatTexts = [
      "Hey, how are you doing?",
      "I'm great! How about you?",
      "Pretty good. Did you see the update?",
      "Yes! The new features look amazing.",
      "Let's catch up later today.",
      "Sure, sounds good!",
      "How is your day going?",
      "It's been busy but productive.",
      "Need help with something?",
      "Can we schedule a meeting?",
      "Thanks for the update!",
      "I'll get back to you soon.",
    ];
    let chatRoomCount = 0;
    for (const user of createdUsers) {
      // Each user gets 2-4 chat rooms with random friends
      const userFriends = createdUsers.filter(u => {
        if (u.id === user.id) return false;
        if (user.role === "patient") return u.role === "doctor" || u.role === "nursing";
        if (user.role === "doctor") return true;
        if (user.role === "nursing") return true;
        return true;
      });
      const numRooms = randInt(2, Math.min(4, userFriends.length));
      const chatPartners = pickN(userFriends, numRooms);
      for (const partner of chatPartners) {
        try {
          const room = await prisma.chatRoom.create({
            data: {
              type: "private",
              participants: {
                create: [
                  { userId: user.id },
                  { userId: partner.id },
                ],
              },
              messages: {
                create: Array.from({ length: randInt(3, 8) }, (_, j) => ({
                  text: pick(chatTexts),
                  senderId: j % 2 === 0 ? user.id : partner.id,
                  isRead: j < 4,
                  createdAt: hoursAgo(20 - j),
                })),
              },
            },
          });
          chatRoomCount++;
        } catch (e) {}
      }
    }
    console.log(`  ✅ ${chatRoomCount} chat rooms with messages created`);

    // ═══════════════════════════════════════════════════════════
    // 6. SERVICE ORDERS (every patient has 3-8 orders, every provider has 2-6)
    // ═══════════════════════════════════════════════════════════
    console.log("\n🏥 Creating Service Orders...");
    const serviceTitles = [
      "Heart Checkup", "Pediatric Consultation", "Neurology Screening", "Emergency Care",
      "Routine Checkup", "Follow-up Visit", "Blood Test Analysis", "X-Ray Review",
      "Physical Therapy", "Vaccination", "Health Screening", "Dermatology Consultation",
      "Orthopedic Assessment", "Gynecology Checkup", "Psychiatric Evaluation", "Wound Dressing",
      "IV Therapy", "EKG Recording", "Ultrasound Scan", "Endoscopy Consultation",
      "Diabetes Management", "Hypertension Follow-up", "Allergy Testing", "Eye Examination",
      "Dental Checkup", "Physiotherapy Session", "Nutrition Counseling", "Post-Surgery Follow-up",
    ];
    const orderDescs = [
      "Patient requires comprehensive evaluation including tests and consultation.",
      "Routine assessment and follow-up to monitor ongoing condition.",
      "Urgent medical attention needed for acute symptoms.",
      "Scheduled appointment for preventive care and health maintenance.",
    ];
    const statuses = ["completed", "completed", "completed", "in_progress", "confirmed", "open", "cancelled"];
    const urgencies = ["normal", "normal", "urgent", "emergency"];
    const medicalTypes = ["doctor", "nursing"];
    let orderCount = 0;

    for (const patient of patients) {
      const numOrders = randInt(3, 8);
      for (let i = 0; i < numOrders; i++) {
        const status = pick(statuses);
        const provider = status !== "open" ? pick(allProviders) : null;
        try {
          const order = await prisma.serviceOrder.create({
            data: {
              serviceType: "with_provider",
              medicalServiceType: pick(medicalTypes),
              patientId: patient.id,
              providerId: provider ? provider.id : null,
              title: pick(serviceTitles),
              description: pick(orderDescs),
              appointmentDate: status === "completed" ? pastDate(randInt(1, 60)) : futureDate(randInt(1, 30)),
              duration: randInt(30, 120),
              urgencyLevel: pick(urgencies),
              status,
              price: randFloat(100, 1000),
              commission: randFloat(10, 50),
              paymentStatus: status === "completed" ? "paid" : status === "cancelled" ? "refunded" : "pending",
              paymentMethod: pick(["cash", "card"]),
              payoutStatus: status === "completed" ? "completed" : "pending",
              meetingLat: patient.latitude,
              meetingLng: patient.longitude,
            },
          });
          orderCount++;

          // Reviews for completed orders
          if (status === "completed" && provider) {
            await prisma.review.create({
              data: {
                userId: patient.id,
                targetId: provider.id,
                targetType: "user",
                rating: randInt(3, 5),
                comment: pick([
                  "Excellent service, very professional!", "Great doctor, highly recommended.",
                  "Very caring and attentive.", "Explained everything clearly.",
                  "Quick and efficient service.", "Highly skilled and knowledgeable.",
                ]),
              },
            });
          }

          // Offers for open orders
          if (status === "open") {
            const offerCount = randInt(1, 3);
            const offerProviders = pickN(allProviders, offerCount);
            for (const op of offerProviders) {
              try {
                await prisma.orderOffer.create({
                  data: {
                    orderId: order.id,
                    providerId: op.id,
                    proposedPrice: order.price + randInt(-50, 200),
                    description: `I can provide this service. Available ${pick(["tomorrow morning", "this afternoon", "next week", "within 2 hours"])}.`,
                    status: "pending",
                  },
                });
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }
    console.log(`  ✅ ${orderCount} service orders created with reviews & offers`);

    // ═══════════════════════════════════════════════════════════
    // 7. PRODUCTS (every pharmacy has 4-6 products)
    // ═══════════════════════════════════════════════════════════
    console.log("\n💊 Creating Products...");
    const productData = [
      { name: "Paracetamol 500mg", desc: "Pain reliever and fever reducer", price: 25, cat: 0 },
      { name: "Amoxicillin 250mg", desc: "Antibiotic for bacterial infections", price: 45, cat: 0 },
      { name: "Vitamin C 1000mg", desc: "Immune system support supplement", price: 60, cat: 2 },
      { name: "Blood Pressure Monitor", desc: "Digital automatic BP monitor", price: 450, cat: 1 },
      { name: "Digital Thermometer", desc: "Fast and accurate temperature reading", price: 85, cat: 1 },
      { name: "First Aid Kit", desc: "Complete emergency first aid kit", price: 120, cat: 3 },
      { name: "Omega-3 Fish Oil", desc: "Heart and brain health supplement", price: 95, cat: 2 },
      { name: "Ibuprofen 400mg", desc: "Anti-inflammatory pain reliever", price: 30, cat: 0 },
      { name: "Hand Sanitizer 500ml", desc: "Alcohol-based germ protection", price: 40, cat: 4 },
      { name: "Surgical Masks 50-pack", desc: "3-layer disposable masks", price: 75, cat: 3 },
      { name: "Glucose Test Strips", desc: "50-pack for glucose meters", price: 110, cat: 1 },
      { name: "Calcium + Vitamin D", desc: "Bone health supplement", price: 70, cat: 2 },
      { name: "Aspirin 75mg", desc: "Cardiovascular protection", price: 20, cat: 0 },
      { name: "Insulin Pen", desc: "Reusable insulin delivery device", price: 350, cat: 1 },
      { name: "Nebulizer Machine", desc: "Portable respiratory treatment", price: 550, cat: 1 },
      { name: "Antihistamine Tablets", desc: "Non-drowsy allergy relief", price: 35, cat: 0 },
      { name: "Wound Care Spray", desc: "Antiseptic for minor cuts and burns", price: 55, cat: 3 },
      { name: "Multivitamin Complex", desc: "Daily essential vitamins and minerals", price: 80, cat: 2 },
      { name: "Lubricating Eye Drops", desc: "Dry eyes and eye strain relief", price: 45, cat: 4 },
      { name: "Elastic Bandage", desc: "Self-adhesive compression bandage", price: 30, cat: 3 },
    ];
    const createdProducts = [];
    for (let i = 0; i < productData.length; i++) {
      const p = productData[i];
      const pharmacy = pharmacies[i % pharmacies.length];
      const cat = ecomCats[p.cat % ecomCats.length];
      try {
        const product = await prisma.product.create({
          data: {
            name: p.name,
            description: p.desc,
            price: p.price,
            stockQuantity: randInt(50, 1000),
            ReservedQuantity: 0,
            categoryId: cat.id,
            merchantId: pharmacy.id,
            Address: pharmacy.address,
            imageUrl: [`https://picsum.photos/seed/prod${i + 1}/400/400`],
          },
        });
        createdProducts.push(product);

        // Product reviews from random patients
        const reviewers = pickN(patients, randInt(1, 4));
        for (const reviewer of reviewers) {
          try {
            await prisma.review.create({
              data: {
                userId: reviewer.id,
                targetId: product.id,
                targetType: "product",
                rating: randInt(3, 5),
                comment: pick([
                  "Great product, fast delivery!", "Exactly what I needed. Good quality.",
                  "Reasonable price for the quality.", "Works as described. Satisfied!", "Would buy again.",
                ]),
              },
            });
          } catch (e) {}
        }
      } catch (e) {}
    }
    // Update product ratings
    for (const product of createdProducts) {
      const reviews = await prisma.review.findMany({ where: { targetId: product.id, targetType: "product" } });
      const total = reviews.reduce((a, r) => a + r.rating, 0);
      const avg = reviews.length > 0 ? total / reviews.length : 0;
      await prisma.product.update({ where: { id: product.id }, data: { avgRating: avg, totalRatings: reviews.length } });
    }
    console.log(`  ✅ ${createdProducts.length} created with reviews`);

    // ═══════════════════════════════════════════════════════════
    // 8. E-COMMERCE ORDERS (every patient has 2-5 ecommerce orders)
    // ═══════════════════════════════════════════════════════════
    console.log("\n🛒 Creating E-Commerce Orders...");
    const ecStatuses = ["delivered", "delivered", "delivered", "shipped", "ready", "preparing", "cancelled"];
    let ecOrderCount = 0;
    for (const patient of patients) {
      const numOrders = randInt(2, 5);
      for (let i = 0; i < numOrders; i++) {
        const status = pick(ecStatuses);
        const shipping = pick(shippings);
        const product = pick(createdProducts);
        if (!product) continue;
        const quantity = randInt(1, 4);
        try {
          await prisma.ecommerceOrder.create({
            data: {
              userId: patient.id,
              ShippingCompanyId: status !== "preparing" ? shipping.id : null,
              totalAmount: product.price * quantity,
              orderStatus: status,
              paymentStatus: status === "cancelled" ? "refunded" : "paid",
              paymentMethod: pick(["credit_card", "cash", "card"]),
              shippingAddress: patient.address,
              deliveryDate: status === "delivered" ? pastDate(randInt(1, 14)) : null,
              items: { create: { productId: product.id, quantity, price: product.price } },
            },
          });
          ecOrderCount++;
        } catch (e) {}
      }
    }
    console.log(`  ✅ ${ecOrderCount} e-commerce orders created`);

    // ═══════════════════════════════════════════════════════════
    // 9. MEDICAL MESSAGES (linked to orders)
    // ═══════════════════════════════════════════════════════════
    console.log("\n💉 Creating Medical Messages...");
    const medMsgTexts = [
      "Hello, I have a question about my prescription.",
      "Sure, I'm here to help. What would you like to know?",
      "When should I take the medication?",
      "Take it twice daily after meals. Any other questions?",
      "Thank you doctor, that's very helpful!",
      "How long will the treatment last?",
      "About 2 weeks. Make sure to complete the full course.",
      "I've been feeling better since the treatment started.",
      "That's great to hear! Keep following the instructions.",
      "Should I come for a follow-up visit?",
      "Yes, please schedule an appointment in two weeks.",
      "Is there any side effect I should watch for?",
      "Mild dizziness is normal. Call me if it gets worse.",
    ];
    let medMsgCount = 0;
    // Get all non-open orders (have a provider assigned)
    const assignedOrders = await prisma.serviceOrder.findMany({
      where: { providerId: { not: null }, status: { not: "open" } },
      take: 50,
    });
    for (const order of assignedOrders) {
      const numMsgs = randInt(2, 6);
      for (let j = 0; j < numMsgs; j++) {
        try {
          await prisma.medicalMessage.create({
            data: {
              fromId: j % 2 === 0 ? order.patientId : order.providerId || order.patientId,
              toId: j % 2 === 0 ? (order.providerId || order.patientId) : order.patientId,
              orderId: order.id,
              message: pick(medMsgTexts),
              messageType: "text",
              isRead: j < numMsgs - 1,
            },
          });
          medMsgCount++;
        } catch (e) {}
      }
    }
    console.log(`  ✅ ${medMsgCount} medical messages created`);

    // ═══════════════════════════════════════════════════════════
    // 10. B2B E-COMMERCE CONVERSATIONS (pharmacy ↔ shipping)
    // ═══════════════════════════════════════════════════════════
    console.log("\n🏢 Creating B2B Conversations...");
    const b2bTexts = [
      "Hi, we'd like to discuss a partnership opportunity.",
      "Sure, what are your delivery capabilities?",
      "We can handle same-day delivery across Cairo and Giza.",
      "Great! Let's schedule a call to discuss the terms.",
      "Our standard rate is 15% commission per delivery.",
      "That works for us. Let's proceed with the contract.",
      "I'll send the contract details by email.",
      "Perfect, looking forward to working together!",
      "We have a bulk order that needs urgent delivery.",
      "No problem, we can arrange pickup within 2 hours.",
    ];
    let b2bCount = 0;
    for (const pharmacy of pharmacies) {
      for (const shipping of shippings) {
        if (pharmacy.id === shipping.id) continue;
        try {
          await prisma.ecommerceConversation.create({
            data: {
              pharmacyId: pharmacy.id,
              shippingCompanyId: shipping.id,
              messageCount: 4,
              messages: {
                create: Array.from({ length: 4 }, (_, j) => ({
                  text: b2bTexts[j],
                  senderId: j % 2 === 0 ? pharmacy.id : shipping.id,
                  createdAt: pastDate(4 - j),
                })),
              },
            },
          });
          b2bCount++;
        } catch (e) {}
      }
    }
    console.log(`  ✅ ${b2bCount} B2B conversations created`);

    // ═══════════════════════════════════════════════════════════
    // 11. CONTRACTS (pharmacy ↔ shipping)
    // ═══════════════════════════════════════════════════════════
    console.log("\n📋 Creating Contracts...");
    let contractCount = 0;
    for (const pharmacy of pharmacies) {
      for (const shipping of shippings) {
        if (pharmacy.id === shipping.id) continue;
        try {
          await prisma.contract.upsert({
            where: { pharmacyId_shippingCompanyId: { pharmacyId: pharmacy.id, shippingCompanyId: shipping.id } },
            update: {},
            data: {
              pharmacyId: pharmacy.id,
              shippingCompanyId: shipping.id,
              initiatedById: pharmacy.id,
              status: pick(["accepted", "accepted", "pending"]),
              message: `Partnership between ${pharmacy.username} and ${shipping.username}`,
              businessDetails: { discountRate: randInt(5, 15), maxDeliveryTime: "48 hours", coverageArea: "Cairo & Giza" },
            },
          });
          contractCount++;
        } catch (e) {}
      }
    }
    console.log(`  ✅ ${contractCount} contracts created`);

    // ═══════════════════════════════════════════════════════════
    // 12. NOTIFICATIONS (every user has 3-6 notifications)
    // ═══════════════════════════════════════════════════════════
    console.log("\n🔔 Creating Notifications...");
    let notifCount = 0;
    const notifTypes = [
      { type: "system", titles: ["Welcome!", "Update Available", "Security Alert"], msgs: ["Welcome to CareNexus!", "A new update is available.", "New login detected from a new device."] },
      { type: "order", titles: ["Order Update", "Order Delivered", "New Request"], msgs: ["Your order status has been updated.", "Your order has been delivered.", "You have a new service request."] },
      { type: "post", titles: ["New Comment", "Post Liked", "New Follower"], msgs: ["Someone commented on your post.", "Your post received a new like.", "You have a new follower."] },
      { type: "chat", titles: ["New Message", "Message Read"], msgs: ["You have a new chat message.", "Your message was read."] },
    ];
    for (const user of createdUsers) {
      const numNotifs = randInt(3, 6);
      const data = [];
      for (let i = 0; i < numNotifs; i++) {
        const nType = pick(notifTypes);
        data.push({
          userId: user.id,
          type: nType.type,
          title: pick(nType.titles),
          message: pick(nType.msgs),
          isRead: Math.random() > 0.4,
        });
      }
      await prisma.notification.createMany({ data });
      notifCount += numNotifs;
    }
    console.log(`  ✅ ${notifCount} notifications created for all users`);

    // ═══════════════════════════════════════════════════════════
    // 13. KNOWLEDGE ARTICLES
    // ═══════════════════════════════════════════════════════════
    console.log("\n📚 Creating Knowledge Articles...");
    const knowledgeData = [
      { title: "Type 2 Diabetes", content: "Type 2 diabetes is a chronic condition affecting how your body metabolizes sugar. The body either resists insulin or doesn't produce enough.", category: "disease" },
      { title: "Hypertension", content: "Hypertension is a common condition where blood pressure against artery walls is high enough to cause health problems.", category: "disease" },
      { title: "Ibuprofen", content: "Ibuprofen is an NSAID that reduces hormones causing inflammation and pain.", category: "drug" },
      { title: "Amoxicillin", content: "Amoxicillin is a penicillin antibiotic used to treat various bacterial infections.", category: "drug" },
      { title: "Cardiac Catheterization", content: "A procedure used to diagnose and treat cardiovascular conditions using a thin tube inserted in an artery.", category: "treatment" },
      { title: "Chest Pain Management", content: "Chest pain can have many causes, from minor issues to serious conditions. Seek immediate medical attention.", category: "symptom" },
    ];
    for (const k of knowledgeData) {
      try {
        await prisma.knowledgeArticle.create({ data: { title: k.title, content: k.content, category: k.category, tags: [k.category], language: "en", authorId: admin.id, source: "local" } });
        console.log(`  ✅ ${k.title}`);
      } catch (e) {}
    }

    // ═══════════════════════════════════════════════════════════
    // 14. ACADEMIC DEGREES (for doctors)
    // ═══════════════════════════════════════════════════════════
    console.log("\n🎓 Creating Academic Degrees...");
    let degreeCount = 0;
    for (const doctor of doctors) {
      const numDegrees = randInt(1, 3);
      const degrees = ["Bachelor of Medicine", "Master of Specialty", "Doctorate (PhD)"];
      const fields = [doctor.specialization || "Medicine", doctor.specialization || "Clinical Medicine"];
      for (let i = 0; i < numDegrees; i++) {
        try {
          await prisma.academicDegree.create({
            data: {
              userId: doctor.id,
              degree: pick(degrees) + ` in ${pick(fields)}`,
              field: pick(fields),
              institution: pick(["Cairo University", "Ain Shams University", "Alexandria University", "Mansoura University"]),
            },
          });
          degreeCount++;
        } catch (e) {}
      }
    }
    console.log(`  ✅ ${degreeCount} academic degrees created`);

    // ═══════════════════════════════════════════════════════════
    // 15. DOCUMENT VERIFICATIONS (KYC for providers)
    // ═══════════════════════════════════════════════════════════
    console.log("\\n📋 Creating Document Verifications...");
    let verificationCount = 0;
    const providerUsers = [...doctors, ...nurses, ...pharmacies, ...shippings];
    for (const provider of providerUsers) {
      const statuses = ['pending', 'pending', 'completed', 'failed'];
      const status = pick(statuses);
      try {
        await prisma.userKYC.upsert({
          where: { userId: provider.id },
          update: {},
          create: {
            userId: provider.id,
            documentation: true,
            identityNumber: `${randInt(10000000000000, 99999999999999)}`,
            identityType: 'national_id',
            dateOfBirth: new Date(1980 + randInt(0, 20), randInt(0, 11), randInt(1, 28)),
            documentPhoto: `https://picsum.photos/seed/kyc_doc_${provider.id}/400/300`,
            medicalDocument: Math.random() > 0.3 ? `https://picsum.photos/seed/kyc_selfie_${provider.id}/200/200` : null,
            verificationStatus: status,
            riskLevel: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
            riskScore: randFloat(0, 100),
            idVerificationData: {
              extractedId: `${randInt(10000000000000, 99999999999999)}`,
              extractedDateOfBirth: '1990-01-01',
            },
          },
        });
        verificationCount++;
        console.log(`  ✅ Verification for ${provider.username} (${status})`);
      } catch (e) {}
    }
    console.log(`  ✅ ${verificationCount} document verifications created`);
    console.log("\n" + "=".repeat(60));
    console.log("✨ Database Seeding Completed Successfully!");
    console.log("=".repeat(60));

    const totalOrders = await prisma.serviceOrder.count();
    const totalECOrders = await prisma.ecommerceOrder.count();
    const totalReviews = await prisma.review.count();
    const totalFriends = await prisma.friendship.count();
    const totalChatRooms = await prisma.chatRoom.count();
    const totalMessages = await prisma.message.count();
    const totalMedMessages = await prisma.medicalMessage.count();
    const totalPosts = await prisma.post.count();
    const totalComments = await prisma.comment.count();
    const totalNotifs = await prisma.notification.count();
    const totalContracts = await prisma.contract.count();
    const totalVerifications = await prisma.userKYC.count({ where: { documentation: true } });

    console.log(`📊 Summary:`);
    console.log(`   Users: ${createdUsers.length} (${doctors.length} doctors, ${nurses.length} nurses, ${patients.length} patients, ${pharmacies.length} pharmacies, ${shippings.length} shipping)`);
    console.log(`   Friendships: ${totalFriends}`);
    console.log(`   Posts: ${totalPosts} | Comments: ${totalComments}`);
    console.log(`   Chat Rooms: ${totalChatRooms} | Messages: ${totalMessages}`);
    console.log(`   Medical Messages: ${totalMedMessages}`);
    console.log(`   Service Orders: ${totalOrders} | Reviews: ${totalReviews}`);
    console.log(`   Products: ${createdProducts.length} | E-Commerce Orders: ${totalECOrders}`);
    console.log(`   B2B Conversations: ${b2bCount} | Contracts: ${totalContracts}`);
    console.log(`   Verifications: ${totalVerifications}`);
    console.log(`   Notifications: ${totalNotifs}`);
    console.log("=".repeat(60));

  } catch (error) {
    console.error("\n❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
