//載入套件
const express = require('express');
const jwt = require('jsonwebtoken');
const CORS = require('cors');
const axios = require('axios');
const mysql = require('mysql');
const { json } = require('body-parser');
const morgan = require('morgan');

require('dotenv').config();

//設定連線埠號
const PORT = process.env.PORT || 5000;

//套件初始化
const app = express();
app.use(morgan('dev'));
app.use(CORS());
app.use(express.json());

//使用pool連線資料庫
const pool = mysql.createPool({
  connectionLimit : 30,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  charset: 'utf8mb4'
});

//一些預設網址
const redirect_uri = process.env.REDIRECT_URL;
const issueAccessTokenUrl = 'https://api.line.me/oauth2/v2.1/token?grant_type=authorization_code';
const verifyIdTokenUrl = 'https://api.line.me/oauth2/v2.1/verify';

//登入取得line channel ID
app.post('/api/login/invitation',(req, res) => {
  const invitationCode = req.body.invitationCode;
  if(process.env.INVITATION_CODE === invitationCode) {
    res.status(200).json({
      success: true,
      client_id: process.env.CLIENT_ID,
    })
  } else {
    res.status(200).json({
      success: false
    })
  }
});

//取得所有訂單
app.get('/api/order/getallorder',authJWTToken, (req, res) => {
  let allOders = [];
  pool.query(
    'select users.user_id, user_pic, user_name, p_size, amount from orders inner join users where orders.user_id = users.user_id order by orders.user_id',
    (err, rows) => {
      if (err) throw err;

      allOders = rows;

      if (rows.length === 0){
        res.status(200).json({
          message: 'no order data',
        })
      } else {
              res.status(200).json({
        allOders,
        success: true
      });
      }
    });
});

//刪除user個人訂單資料
app.get('/api/order/deletemyorder', authJWTToken ,(req, res) => {
  const user_id =req.user.userId;

  pool.query(
    'DELETE FROM orders WHERE user_id = ?',
    [user_id],
    (err) => {
      if (err){
        res.status(500).json({
          success: false,
          message: 'DB異常'
        })
      } else {
        res.status(200).json({
          success: true,
          message: '已刪除訂單資料',
        })
      }
    }
  )
});

//取得user個人訂單資料
app.get('/api/order/getmyorder', authJWTToken ,(req, res) => {
  const user_id = req.user.userId;

  pool.query(
    'SELECT p_size, amount FROM orders WHERE user_id = ?',
    [user_id],
    (err, rows) =>{
      if (err) {
        res.status(500).json({
          success: false,
          message: 'DB異常'
        })
      }else if (rows.length === 0){
        res.status(200).json({
          success: false,
          message: '沒有訂單'
        })
      } else {
        res.status(200).json({
          success: true,
          order: rows,
        });
      }
    })
});

//接收USER送出的訂單資料
app.post('/api/order/submit', authJWTToken ,(req, res) => {

  // const orderFromUser = req.body.order;
  // res.send(req.body); //這是前端傳來的
  // res.send(req.user); //這是JWT驗證解析的資料
  // console.log('進來了沒');
  // res.status(200).json({
  //   success: true,
  //   user: req.user,
  //   order: req.body.order,
  // });
    const orderFromUser = req.body.order;
    const user_id = req.user.userId;
    const values = orderFromUser.map(item => [user_id ,item.size, item.quantity]);

    pool.query(
      'INSERT INTO orders (user_id, p_size, amount) VALUES ?', 
      [values], 
      (err) => {
        if (err) {
          console.error(err);
          res.status(500).json({
            success: false,
            message: 'DB異常'
          })
        } else {
          res.status(200).json({
            success: true,
          })
        }
      });
});

//確認CODE並申請token codefortoken API
app.post('/api/codefortoken', (req, res) => {
  //取得code
  const code = req.body.code;

  //如果沒有code
  if (!code) {
    return res.status(400).json({
      success: false,
      message: 'Server端沒有收到code',
    });
  }

  //向line申請token
  axios.post(issueAccessTokenUrl,{
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    code: code,
    redirect_uri: redirect_uri,
  },{
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
  .then( result =>{
    //如果使用code申請token成功，就使用token向line申請使用者資料
    console.log('已獲得token，向line申請使用者資料...');
    
    //先設定變數
    const idToken = result.data.id_token;
    
    //向line申請使用者資料
    axios.post(verifyIdTokenUrl, {
      id_token: idToken,
      client_id: process.env.CLIENT_ID,
    }, {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      }
    })
    .then( result =>{
      //如果取得使用者資料成功，先比對資料庫是否有該使用者資料
        //定義取得的使用者資料
      const userId = result.data.sub;
      const userName = result.data.name;
      const userPic = result.data.picture;
      const userEmail = result.data.email; 

      //定義要使用在JWT的資料
      const user = {
        userId,
        userName,
        userPic,
      }

      console.log('已獲得使用者資料：', userId, userName, userEmail);

      //比對資料庫是否有該使用者資料
      pool.query('SELECT * FROM users WHERE user_id = ?', [userId], (err, rows) => {
        if (err) throw err;

        if (rows.length === 0){
          console.log('資料庫沒有該使用者資料，新增使用者資料...');
          
          //如果資料庫沒有該使用者資料，就先新增資料
          pool.query('INSERT INTO users (user_id, user_name, user_pic, user_email) VALUES (?, ?, ?, ?)', 
          [userId, userName, userPic, userEmail], (err, rows) => {
            if (err) throw err;
            console.log(`已新增使用者資料：${userId}, ${userName}, ${userPic}, ${userEmail}`);
          });

          //此處要改成使用JWT授權
          jwt.sign(user, process.env.TOKEN_SECRET, { expiresIn: '1h'}, (err, token) => {
            if (err) {
              console.log('err');
              res.status(403),json({
                success: false,
                message: '無法生成金鑰',
              })
            } else {
              res.json({ token, user });
            }
          })

        }else{

          //如果資料庫有該使用者資料，就直接回傳token
          console.log('資料庫有該使用者資料，更新資料庫中使用者資料，並回傳TOKEN');
          pool.query(
            'UPDATE users SET user_name = ?, user_pic = ?, user_email = ? WHERE user_id = ?',
            [userName, userPic, userEmail, userId],
            (err) => {
              if (err) throw err;
              console.log('使用者資料更新完成');
            }
          )
          //簽發JWT TOKEN
          jwt.sign(user, process.env.TOKEN_SECRET, { expiresIn: '1h'}, (err, token) => {
            if (err) {
              console.log('err');
              res.status(403),json({
                success: false,
                message: '無法生成金鑰',
              })
            } else {
              res.json({ token, user });
            }
          })
        }
      })

    })
    .catch( err =>{
      //如果取得使用者資料失敗，就向前端回傳錯誤訊息
      console.log('取得使用者資料失敗');
      res.status(401).json({ 
        message: err.response.data.error_description,
      });
    })

  })
  .catch( err => {
    //如果使用code申請token失敗，就回傳錯誤訊息
    console.log('使用code申請token失敗');
    res.status(401).json({
      message: err.response.data.error_description,
    });
  })
});

//測試用API
app.get('/api/test', (req, res) => {

  pool.query('SELECT * FROM orders',
  (err, rows) => {
    if (err) throw err;
      else {
        console.log(rows);
      }
  })
});

//使用JWT驗證的middleware
function authJWTToken (req, res, next){
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  //如果金鑰是空的，顯示403
  if (token == null) {
    return res.status(403).json({
      success: false,
      message: '無法驗證，請重新登入',
      btnText: '重新登入',
    });    
  }
  //驗證開始
  jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: '認證過期或錯誤',
        btnText: '重新登入',
      });
    } else {
      req.user = user;
      next();
    }
  });
}

//驗證我開立的JWT TOKEN
app.post('/api/verifyMyToken', authJWTToken, (req, res) => {
  res.status(200).json({
    success: true,
    user: req.user,
  })
})

app.listen(PORT, () => console.log(`Server started http://localhost:${PORT}`));