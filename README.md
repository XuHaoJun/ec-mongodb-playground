# ec-mongodb-playground

Mongodb 版本： 6

主要測試商品超賣問題

```sh
## 這邊使用 docker-compose 模擬 mongodb cluster(PSS 架構)。
git submodule update --init --recursive
cd docker-compose/ec-mongodb-playground
docker compose up -d
docker-compose exec configsvr01 sh -c "mongosh < /scripts/init-configserver.js"
docker-compose exec shard01-a sh -c "mongosh < /scripts/init-shard01.js"
docker-compose exec shard02-a sh -c "mongosh < /scripts/init-shard02.js"
docker-compose exec shard03-a sh -c "mongosh < /scripts/init-shard03.js"
docker-compose exec router01 sh -c "mongosh < /scripts/init-router.js"
## 會進去 mongosh
docker-compose exec router01 mongosh --port 27017
## 啟用 sharding
# sh.enableSharding("myapp")
## 不太確定電商的情境下，該如何選擇 shardKey，這邊簡單使用商品價格與訂單時間
# db.adminCommand( { shardCollection: "myapp.products", key: { price: 1 } } )
# db.adminCommand( { shardCollection: "myapp.orders", key: { createdAt: 1 } } )
```

模擬情境： 四個客戶買滑鼠，每次下單一隻滑鼠，共下單 10000 次。

## 悲觀鎖

### MongoDB

Read snapshot 類似 SQL 的 SERIALIZABLE，majority 則是類似 READ COMMITED

Write 指定在 majority，跟行鎖差不多效果。

```js
const session = await mongoose.startSession({
  defaultTransactionOptions: {
    readConcern: ReadConcern.fromOptions({ level: "snapshot" }),
    writeConcern: WriteConcern.fromOptions({ w: "majority" }),
  },
});
```

這邊要注意的是，`session.commitTransaction();`，不會像 SQL 一樣卡住，然後競爭該項資源，會直接跳出 Write Conflict 錯誤，很明顯是為了可用性得妥協。

但對商品購買而言，在發生大量搶購時，會造成大量 request 失敗，很明顯不是我們想要的。

這邊準備使用 redis 記錄該商品短時間(ex:1 秒)購買流量，若超過閥值，則動態在 rabbitmq 建立該商品專用的 queue，對應現實就是典型的排隊購買
，不過這邊會牽涉如何 http response 的問題，實際做法限流(redis 用 userId, 購物車 id, 選擇的商品 ids + amount, 做一個購物事件的 hash)，
和顯示該次購買已提交，請稍候的訊息。

### SQL

Read, Isolation 設定，REPEATABLE READ 或 SERIALIZABLE。

Write, 行鎖(FOR UPDATE)。

```sql
SELECT * FOR UPDATE
FROM Product
WHERE id = xx
```

## 樂觀鎖

自己實作 CAS(Compare-And-Swap)，不論 MongoDB 或 SQL，都要自己實作。把版本的資訊換個地方放，應該也能利用 redis 之類的做到。

## Message Queue

效能整體上應該跟悲觀鎖差不多，不過資料庫可以降低一些負擔。

## 參考資料

1. [transactions-in-mongodb](https://blog.allegro.tech/2022/12/transactions-in-mongodb.html)
