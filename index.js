require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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

async function run() {
	try {
		const db = client.db("profast");
		const userCollection = db.collection("users");
		const parcelCollection = db.collection("parcels");
		const paymentsCollection = db.collection("payments");
		const trackingCollection = db.collection("trackings");

		app.post("/parcel", async (req, res) => {
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

		app.get("/parcels", async (req, res) => {
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

		app.delete("/parcel/:id", async (req, res) => {
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

		app.get("/parcel/:id", async (req, res) => {
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

		app.post("/trackings", async (req, res) => {
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

		app.get("/trackings/:trackingId", async (req, res) => {
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

		app.post("/create-payment-intent", async (req, res) => {
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

		app.get("/payments", async (req, res) => {
			try {
				const userEmail = req.query.email;

				// 🔍 Query setup
				const query = userEmail ? { email: userEmail } : {};
				const options = {
					sort: { paid_at: -1 }, // ✅ latest payments first
				};

				const payments = await paymentsCollection.find(query, options).toArray();

				res.send(payments);
			} catch (error) {
				console.error("Error fetching payment history:", error);
				res.status(500).send({ message: "Failed to get payments" });
			}
		});

		app.post("/payments", async (req, res) => {
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

				// Check if user already exists
				const existingUser = await userCollection.findOne({ email: userData.email });
				if (existingUser) {
					return res.status(409).json({ message: "User already exists" });
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

		app.patch("/users/:email", async (req, res) => {
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
