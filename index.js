require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

var admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FIREBASE_SERVICE_KEY, "base64").toString("utf8");
var serviceAccount = JSON.parse(decoded);
if (!admin.apps.length) {
	admin.initializeApp({
		credential: admin.credential.cert(serviceAccount),
	});
}

var express = require("express");
const stripe = require("stripe")(process.env.PROFAST_STRIPE_SECRET_KEY);
var cors = require("cors");
var app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mljuhsj.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	},
});

const verifyFirebaseToken = async (req, res, next) => {
	try {
		const authHeader = req.headers.authorization;
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return res.status(401).json({ message: "Unauthorized: No token provided" });
		}

		const token = authHeader.split(" ")[1];
		const decodedToken = await admin.auth().verifyIdToken(token);
		req.decoded = decodedToken;
		next();
	} catch (error) {
		console.error("Token verification failed:", error.message);
		res.status(403).json({ message: "Forbidden: Invalid token" });
	}
};

const verifyEmailMatch = (req, res, next) => {
	const userEmail = req.query.email || req.params.email || req.body.email;
	if (!req.decoded?.email || req.decoded.email !== userEmail) {
		return res.status(403).json({ message: "Forbidden access" });
	}
	next();
};

async function run() {
	try {
		const db = client.db("profast");
		const userCollection = db.collection("users");
		const parcelCollection = db.collection("parcels");
		const paymentsCollection = db.collection("payments");
		const trackingCollection = db.collection("trackings");
		const ridersCollection = db.collection("riders");

		app.post("/parcel", verifyFirebaseToken, async (req, res) => {
			try {
				const parcel = req.body;

				if (!parcel?.tracking_id) {
					return res.status(400).json({ error: "Tracking ID is required" });
				}

				const result = await parcelCollection.insertOne(parcel);
				res.status(201).json({
					message: "Parcel saved successfully",
					insertedId: result.insertedId,
				});
			} catch (err) {
				console.error("Error inserting parcel:", err.message);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		app.get("/parcels", verifyFirebaseToken, async (req, res) => {
			try {
				const userEmail = req.query.email; // example: /parcels?email=user@example.com
				let query = {};

				if (userEmail) {
					query.created_by = userEmail;
				}

				const projection = {
					title: 1,
					tracking_id: 1,
					created_by: 1,
					senderRegion: 1,
					receiverRegion: 1,
					parcelWeight: 1,
					deliveryCost: 1,
					delivery_status: 1,
					payment_status: 1,
					created_at: 1,
					type: 1,
				};

				const parcels = await parcelCollection
					.find(query)
					.project(projection)
					.sort({ created_at: -1 }) // latest first
					.toArray();

				res.send(parcels);
			} catch (error) {
				res.status(500).send({ message: "Server Error", error: error.message });
			}
		});

		app.delete("/parcel/:id", verifyFirebaseToken, verifyEmailMatch, async (req, res) => {
			try {
				const id = req.params.id;
				const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });

				if (result.deletedCount === 1) {
					res.send({ success: true, message: "Parcel deleted successfully", deletedCount: 1 });
				} else {
					res.status(404).send({ success: false, message: "Parcel not found" });
				}
			} catch (error) {
				console.error("Delete error:", error);
				res.status(500).send({ success: false, message: "Server error" });
			}
		});

		app.get("/parcel/:id", verifyFirebaseToken, verifyEmailMatch, async (req, res) => {
			try {
				const id = req.params.id;
				const query = { _id: new ObjectId(id) };
				const parcel = await parcelCollection.findOne(query);

				if (!parcel) {
					return res.status(404).send({ message: "Parcel not found" });
				}

				res.send(parcel);
			} catch (error) {
				console.error("Error fetching parcel:", error);
				res.status(500).send({ message: "Internal server error" });
			}
		});

		app.post("/trackings", verifyFirebaseToken, async (req, res) => {
			try {
				const trackingData = req.body;

				if (!trackingData?.tracking_id || !trackingData?.status) {
					return res.status(400).json({ error: "Tracking ID and status are required" });
				}

				trackingData.timestamp = new Date().toISOString(); // অটোমেটিক টাইমস্ট্যাম্প সংযুক্ত করা

				const result = await trackingCollection.insertOne(trackingData);
				res.status(201).json({
					message: "Tracking info saved successfully",
					insertedId: result.insertedId,
				});
			} catch (err) {
				console.error("Error inserting tracking info:", err.message);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		app.get("/trackings/:trackingId", verifyFirebaseToken, async (req, res) => {
			try {
				const { trackingId } = req.params;

				const trackingHistory = await trackingCollection
					.find({ tracking_id: trackingId })
					.sort({ timestamp: -1 }) // সর্বশেষ আপডেট আগে দেখাবে
					.toArray();

				res.status(200).json(trackingHistory);
			} catch (err) {
				console.error("Error fetching tracking info:", err.message);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		app.post("/create-payment-intent", verifyFirebaseToken, async (req, res) => {
			try {
				const { amountInCents } = req.body;

				if (!amountInCents || isNaN(amountInCents)) {
					return res.status(400).json({ error: "Invalid amountInCents" });
				}

				const paymentIntent = await stripe.paymentIntents.create({
					amount: Math.round(amountInCents),
					currency: "usd",
					payment_method_types: ["card"],
				});

				res.json({ clientSecret: paymentIntent.client_secret });
			} catch (error) {
				res.status(500).json({ error: error.message });
			}
		});

		app.get("/payments", verifyFirebaseToken, verifyEmailMatch, async (req, res) => {
			try {
				const userEmail = req.query.email;

				if (!userEmail) {
					return res.status(400).json({ message: "Email is required" });
				}

				const query = { email: userEmail };
				const options = {
					sort: { paid_at: -1 },
				};

				const payments = await paymentsCollection.find(query, options).toArray();

				res.send(payments);
			} catch (error) {
				console.error("Error fetching payment history:", error);
				res.status(500).send({ message: "Failed to get payments" });
			}
		});

		app.post("/payments", verifyFirebaseToken, verifyEmailMatch, async (req, res) => {
			try {
				const { parcelId, email, amount, paymentMethod, transactionId } = req.body;

				// 1️⃣ Validation
				if (!parcelId || !email || !amount) {
					return res.status(400).json({ message: "parcelId, email, and amount are required" });
				}

				// 2️⃣ Update parcel's payment_status
				const updateResult = await parcelCollection.updateOne(
					{ _id: new ObjectId(parcelId) },
					{ $set: { payment_status: "paid" } }
				);

				if (updateResult.modifiedCount === 0) {
					return res.status(404).json({ message: "Parcel not found or already paid" });
				}

				// 3️⃣ Insert payment record
				const paymentDoc = {
					parcelId,
					email,
					amount,
					paymentMethod,
					transactionId,
					paid_at_string: new Date().toISOString(),
					paid_at: new Date(), // for sorting by recent payment
				};

				const paymentResult = await paymentsCollection.insertOne(paymentDoc);

				// ✅ Final Response
				res.status(201).json({
					message: "Payment recorded and parcel marked as paid",
					insertedId: paymentResult.insertedId,
				});
			} catch (error) {
				console.error("Payment processing failed:", error);
				res.status(500).json({ message: "Failed to record payment" });
			}
		});

		app.post("/users", async (req, res) => {
			try {
				const userData = req.body;

				//Check if user already exists
				const existingUser = await userCollection.findOne({ email: userData.email });
				if (existingUser) {
					return res.status(200).json({
						message: "User already exists. Use PATCH to update login info.",
						exists: true,
					});
				}

				const result = await userCollection.insertOne(userData);
				res.status(201).json({
					message: "User registered successfully",
					insertedId: result.insertedId,
				});
			} catch (err) {
				console.error("Error saving user:", err.message);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		app.patch("/users/:email", verifyFirebaseToken, verifyEmailMatch, async (req, res) => {
			try {
				const email = req.params.email;
				const updateData = req.body;

				const result = await userCollection.updateOne({ email }, { $set: updateData });

				if (result.modifiedCount > 0) {
					res.status(200).json({ message: "User info updated successfully" });
				} else {
					res.status(404).json({ message: "User not found or no changes made" });
				}
			} catch (err) {
				console.error("Error updating user:", err.message);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		app.post("/riders", verifyFirebaseToken, verifyEmailMatch, async (req, res) => {
			try {
				const rider = req.body;

				// 🧠 Check if already applied
				const existing = await ridersCollection.findOne({ email: rider.email });
				if (existing) {
					return res.status(409).json({ message: "You have already submitted your application." });
				}

				const result = await ridersCollection.insertOne(rider);

				res.status(201).json({
					message: "Application submitted successfully",
					insertedId: result.insertedId,
				});
			} catch (err) {
				console.error("Error inserting rider application:", err.message);
				res.status(500).json({ error: "Internal Server Error" });
			}
		});

		app.get("/riders", verifyFirebaseToken, async (req, res) => {
			try {
				const status = req.query.status;
				const query = {};

				if (status && status !== "all") {
					query.status = status;
				}

				const riders = await ridersCollection.find(query).toArray();

				res.status(200).json({
					success: true,
					count: riders.length,
					data: riders,
				});
			} catch (error) {
				console.error("Error fetching riders:", error);
				res.status(500).json({
					success: false,
					message: "Failed to fetch riders",
				});
			}
		});
		app.patch("/riders/:id", verifyFirebaseToken, async (req, res) => {
			try {
				const { id } = req.params;
				const { status, email } = req.body;

				const result = await ridersCollection.updateOne({ _id: new ObjectId(id) }, { $set: { status } });

				// Update user role only if status is active
				if (status === "active" && email) {
					const userQuery = { email };
					const userUpdateDoc = {
						$set: { role: "rider" },
					};
					await userCollection.updateOne(userQuery, userUpdateDoc);
				}

				res.status(200).json({
					success: true,
					message: "Rider status updated successfully",
					result,
				});
			} catch (error) {
				console.error("Failed to update rider status:", error);
				res.status(500).json({
					success: false,
					message: "Failed to update rider status",
				});
			}
		});

		// GET /users/search?query=arif
		app.get("/users/search", verifyFirebaseToken, async (req, res) => {
			const { query } = req.query;

			if (!query) {
				return res.status(400).send({ message: "Query parameter is required" });
			}

			try {
				const users = await userCollection
					.find({
						$or: [{ displayName: { $regex: query, $options: "i" } }, { email: { $regex: query, $options: "i" } }],
					})
					.project({ displayName: 1, email: 1, role: 1 }) // optional fields
					.limit(10)
					.toArray();

				res.send(users);
			} catch (error) {
				console.error("User search error:", error);
				res.status(500).send({ message: "Failed to search users" });
			}
		});

		// PATCH /users/:id/role
		app.patch("/users/:id/role", verifyFirebaseToken, async (req, res) => {
			const { id } = req.params;
			const { role } = req.body;

			if (!["admin", "editor", "rider", "user"].includes(role)) {
				return res.status(400).send({ message: "Invalid role" });
			}

			try {
				const result = await userCollection.updateOne({ _id: new ObjectId(id) }, { $set: { role } });

				res.send({ message: `User role updated to ${role}`, result });
			} catch (error) {
				console.error("Error updating user role:", error);
				res.status(500).send({ message: "Failed to update user role" });
			}
		});

		// GET /users/:email/role
		app.get("/users/:email/role", async (req, res) => {
			try {
				const email = req.params.email;

				if (!email) {
					return res.status(400).send({ message: "Email is required" });
				}

				const user = await userCollection.findOne({ email });

				if (!user) {
					return res.status(404).send({ message: "User not found" });
				}

				res.send({ role: user.role || "user" }); // fallback role
			} catch (error) {
				console.error("Error getting user role:", error);
				res.status(500).send({ message: "Failed to get role" });
			}
		});

		// // Send a ping to confirm a successful connection
		// await client.db("admin").command({ ping: 1 });
		// console.log("Pinged your deployment. You successfully connected to MongoDB!");
	} finally {
	}
}
run().catch(console.dir);

module.exports = app;

app.get("/", (req, res) => {
	res.send("Profast home page api");
});

app.listen(port, () => {
	console.log(`profast server is running on port: ${port}`);
});
