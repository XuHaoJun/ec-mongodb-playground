const axios = require("axios");
const _ = require("lodash");
const { setTimeout: setTimeoutAsync } = require("timers/promises");

async function purchase(
  id,
  amount,
  customerId,
  previewOrder,
  productViewInClient
) {
  try {
    const response = await axios.post("http://localhost:3000/purchase", {
      id,
      amount,
      customerId,
      previewOrder,
      productViewInClient,
    });

    console.log(response.data.message);
  } catch (error) {
    console.error(error);
  }
}

async function test() {
  const customerIds = [
    "60a7d7d7d7d7d7d7d7d7d7d6",
    "60a7d7d7d7d7d7d7d7d7d7d7",
    "60a7d7d7d7d7d7d7d7d7d7d8",
    "60a7d7d7d7d7d7d7d7d7d7d9",
  ];
  const productPrice = 999;
  const ps = [];
  for (let i = 0; i < 2500; i++) {
    for (const customerId of customerIds) {
      const amount = 1;
      const p = purchase(
        "60a7ee5b22b08413f0c139a0",
        amount,
        customerId,
        {
          totalPrice: productPrice * amount,
        },
        {
          price: productPrice,
        }
      );
      ps.push(p);
      if (i % 10 === 0) {
        await setTimeoutAsync(100);
      }
    }
  }
  await Promise.all(ps);
}

test();
