require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

var express = require("express");
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
