const express = require("express");
const path = require("path");
const config = require("./config");
const app = express();
const {
  messageService,
  replyService,
  searchService,
  channelService
} = require("./lib/services");
const {
  messageRoutes,
  searchRoutes,
  userRoutes,
  generalRoutes,
  channelRoutes
} = require("./routes");
const http = require("http");
const session = require("express-session");
const MongoStore = require("connect-mongo")(session);
const server = http.Server(app);
const socketIO = require("socket.io");
const io = socketIO(server);

io.on("connection", async socket => {
  socket.on("init", async userId => {
    socket.join(userId);
    const channels = await channelService.getChannels(userId);

    channels.forEach(channel => {
      socket.join(channel.id);
    });
  });

  socket.on("leave", async channelId => {
    socket.leave(channelId);
  });

  socket.on("update-message", async messageId => {
    const updatedMessage = await messageService.getMessageView(messageId);
    await searchService.updateMessage(updatedMessage);
    socket.to(updatedMessage.channelId).emit("update-message", updatedMessage);
  });

  socket.on("delete-message", async message => {
    await searchService.deleteMessage(message.id);
    socket.to(message.channelId).emit("delete-message", message.id);
  });

  socket.on("first-direct-message", message => {
    const { userId, channelId } = message;
    socket.to(userId).emit("first-direct-message", channelId);
  });

  socket.on("started-typing", message => {
    const { user, channelId } = message;
    socket.to(channelId).emit("started-typing", { user, channelId });
  });

  socket.on("stopped-typing", message => {
    const { user, channelId } = message;
    socket.to(channelId).emit("stopped-typing", { user, channelId });
  });

  socket.on("message", async message => {
    const { userId, channelId, text } = message;
    const createdAt = Date.now();
    const createdMessage = await messageService.createMessageView(
      userId,
      channelId,
      createdAt,
      text
    );

    await searchService.saveMessage(createdMessage);
    socket.emit("my-message", createdMessage);
    socket.to(channelId).send(createdMessage);
  });

  socket.on("reply", async reply => {
    const { userId, channelId, messageId, text } = reply;
    const createdAt = Date.now();
    const createdReply = await replyService.createReplyView(
      userId,
      channelId,
      messageId,
      createdAt,
      text
    );

    socket.emit("my-reply", createdReply);
    socket.to(channelId).emit("reply", createdReply);
  });
});

app.use(
  session({
    resave: false,
    saveUninitialized: false,
    name: "flack-session",
    secret: process.env.SECRET || "secret",
    store: new MongoStore({
      url: config.url
    })
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "..", "dist")));

app.use("/", [
  generalRoutes,
  messageRoutes,
  channelRoutes,
  userRoutes,
  searchRoutes
]);

app.use((req, res, next) => {
  res.status(404).end("404 not found");
});

app.use((error, req, res, next) => {
  res.status(error.statusCode || 500).json({ error: error.message });
});

module.exports = server;
