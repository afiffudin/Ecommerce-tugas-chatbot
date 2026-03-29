const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
require('dotenv').config();

const app = express();

app.set('view engine', 'ejs');

app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: 'admin-secret',
  resave: false,
  saveUninitialized: false
}));

app.use('/', require('./routes/admin'));

app.listen(3000, () => {
  console.log('Server running http://localhost:3000');
});
