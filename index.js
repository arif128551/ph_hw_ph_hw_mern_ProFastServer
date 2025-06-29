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
