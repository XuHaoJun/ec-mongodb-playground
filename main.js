// Import required modules
const express = require("express");
const mongoose = require("mongoose");
const { ReadConcern, WriteConcern, MongoServerError } = require("mongodb");
const _ = require("lodash");
const { setTimeout: setTimeoutAsync } = require("timers/promises");

const { Faker, zh_TW } = require("@faker-js/faker");
const faker = new Faker({ locale: zh_TW });
faker.seed(1);

// Set up Express app
const app = express();
app.use(express.json());

// Connect to MongoDB database
mongoose.connect("mongodb://localhost:27117,localhost:27118/myapp", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));

// Define product schema
const productSchema = new mongoose.Schema(
  {
    name: String,
    price: Number,
    inventory: Number,
  },
  { timestamps: true }
);
// productSchema.index({ _id: 1, inventory: 1 }, { unique: false });
const Product = mongoose.model("Product", productSchema);

// Define customer schema
const customerSchema = new mongoose.Schema(
  {
    name: String,
    balance: Number,
  },
  { timestamps: true }
);
// customerSchema.index({ _id: 1, balance: 1 }, { unique: false });
const Customer = mongoose.model("Customer", customerSchema);

// Define order schema
const orderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
    },
    items: [
      {
        amount: { type: Number, required: true },
        productSnapshot: {
          _id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: "Product",
          },
          name: { type: String, required: true },
          price: { type: Number, required: true },
        },
      },
    ],
    totalPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    // paymentMethod: {
    //   type: String,
    //   required: true,
    // },
    // isPaid: {
    //   type: Boolean,
    //   required: true,
    //   default: false,
    // },
    // paidAt: {
    //   type: Date,
    // },
    // isDelivered: {
    //   type: Boolean,
    //   required: true,
    //   default: false,
    // },
    // deliveredAt: {
    //   type: Date,
    // },
    // orderPaymentID: {
    //   type: String,
    // },
  },
  { timestamps: true }
);
const Order = mongoose.model("Order", orderSchema);

async function purchaseHandler(req, res) {
  const reqBody = req.body;
  const { id, amount, customerId } = reqBody;
  const session = await mongoose.startSession({
    defaultTransactionOptions: {
      // 這邊讀寫都是一次 CAS，所以不需要 snapshot 級別
      readConcern: ReadConcern.fromOptions({ level: "majority" }),
      writeConcern: WriteConcern.fromOptions({ w: "majority" }),
      readPreference: "primary",
    },
  });
  session.startTransaction();
  try {
    const product = await Product.findOneAndUpdate(
      { _id: id, inventory: { $gte: amount } },
      { $inc: { inventory: -1 * amount } },
      { session, new: true }
    );
    if (!product) {
      throw new Error("Product not found or insufficient inventory");
    }
    if (reqBody.productViewInClient.price !== product.price) {
      throw new Error("Product price changed");
    }
    const totalPrice = product.price * amount;
    if (reqBody.previewOrder.totalPrice !== totalPrice) {
      throw new Error("Incorrect Order Total Price");
    }
    const customer = await Customer.findOneAndUpdate(
      { _id: customerId, balance: { $gte: totalPrice } },
      { $inc: { balance: -1 * totalPrice } },
      { session, new: true }
    ).select({ _id: 1 });
    if (!customer) {
      throw new Error("Customer not found or insufficient funds");
    }
    // 理論上是要購物車轉 Order 一個 transacation，結帳流程又一個 transaction
    const order = new Order({
      customer: customer._id,
      items: [
        {
          amount,
          productSnapshot: {
            _id: product._id,
            name: product.name,
            price: product.price,
          },
        },
      ],
      totalPrice,
    });
    await order.save();
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  }
}

// Define API endpoint for purchasing a product
app.post("/purchase", async (req, res) => {
  let numRetry = 3;
  while (numRetry > 0) {
    try {
      await purchaseHandler(req, res);
      res.send("Purchase successful");
      return;
    } catch (error) {
      if (
        error instanceof MongoServerError &&
        error.code === 112 &&
        numRetry - 1 > 0
      ) {
        numRetry -= 1;
        const delyMs = _.random(100, 2500);
        await setTimeoutAsync(delyMs);
      } else {
        res.status(400).send(error.message);
        return;
      }
    }
  }
});

async function initDb() {
  await Promise.all([
    Order.createCollection(),
    Customer.createCollection(),
    Product.createCollection(),
  ]);
  const session = await mongoose.startSession({
    defaultTransactionOptions: {
      willRetryWrite: false,
      readConcern: ReadConcern.fromOptions({ level: "majority" }),
      writeConcern: WriteConcern.fromOptions({ w: "majority" }),
    },
  });
  session.startTransaction();
  try {
    const numProductt = await Product.countDocuments({}, { session });
    if (numProductt === 0) {
      await new Product({
        _id: new mongoose.Types.ObjectId("60a7ee5b22b08413f0c139a0"),
        name: "羅技MX Anywhere 2S",
        price: 999,
        inventory: 10000,
      }).save();
    }
    const numCustomer = await Customer.countDocuments({}, { session });
    if (numCustomer === 0) {
      await Promise.all([
        new Customer({
          _id: new mongoose.Types.ObjectId("60a7d7d7d7d7d7d7d7d7d7d6"),
          name: faker.internet.displayName(),
          balance: 999 * 2500,
        }).save(),
        new Customer({
          _id: new mongoose.Types.ObjectId("60a7d7d7d7d7d7d7d7d7d7d7"),
          name: faker.internet.displayName(),
          balance: 999 * 2500,
        }).save(),
        new Customer({
          _id: new mongoose.Types.ObjectId("60a7d7d7d7d7d7d7d7d7d7d8"),
          name: faker.internet.displayName(),
          balance: 999 * 2500,
        }).save(),
        new Customer({
          _id: new mongoose.Types.ObjectId("60a7d7d7d7d7d7d7d7d7d7d9"),
          name: faker.internet.displayName(),
          balance: 999 * 2500,
        }).save(),
      ]);
    }
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  }
}

async function main() {
  await initDb();
  // Start server
  app.listen(3000, () => {
    console.log("Server started on port 3000");
  });
}

main();
