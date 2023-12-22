//載入套件
const express = require('express');
const jwt = require('jsonwebtoken');
const CORS = require('cors');
const axios = require('axios');
const mysql = require('mysql');
const { json } = require('body-parser');
const { log } = require('console');
const { access } = require('fs');
require('dotenv').config();

//設定連線埠號
const PORT = process.env.PORT || 5000;

//套件初始化
const app = express();
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
const getUserInfoUrl = 'https://api.line.me/oauth2/v2.1/userinfo';

//測試用API
// app.get('/api', async (req, res) => {
//   pool.query(
//     'SELECT * FROM users',
//     (err,rows) => {
//       res.status(200).json(rows);
//     }
//   )
// });
  
app.get('/api/order/getallorder',async (req, res) => {
  let allOders = [];
  // console.log(req.headers.authorization.split(' ')[1], '已經進入getallorder');
  try{
      const access_token = req.headers.authorization.split(' ')[1];
      let userInfo = await verifyTokenFromLineAPI(access_token);
      if (userInfo){
        let user_id = userInfo.data.userId;

        pool.query(
          'select users.user_id, user_pic, user_name, p_size, amount from orders inner join users where orders.user_id = users.user_id order by orders.user_id',
          (err, rows) => {
            if (err) throw err;
  
            allOders = rows;
            res.status(200).json(allOders);
  
            if (rows.length === 0){
              res.status(200).json({
                message: 'no order data',
              })
            }
          });
      }
      
    }catch(err){
      res.status(500).json({
        error: err.message,
      });
    }
});

//刪除user個人訂單資料
app.get('/api/order/deletemyorder', async (req, res) => {
  try{
    const access_token = req.headers.authorization.split(' ')[1];
    let userInfo = await verifyTokenFromLineAPI(access_token);
    if(userInfo){
      let user_id = userInfo.data.userId;

      pool.query(
        'DELETE FROM orders WHERE user_id = ?',
        [user_id],
        (err) => {
          if (err){
            res.status(500).json({
              error: err.message,
            })
          }
            res.status(200).json({
              message: '已刪除訂單資料',
            })
        }
      )
    }


    }catch(err){
      console.log(err);
    }
});

//取得user個人訂單資料
app.get('/api/order/getmyorder', async (req, res) => {

  console.log(req.headers.authorization.split(' ')[1], '已經進入getmyorder');
  try{
    const access_token = req.headers.authorization.split(' ')[1];
    let userInfo = await verifyTokenFromLineAPI(access_token);
    if (userInfo){
      let user_id = userInfo.data.userId;

      pool.query(
        'SELECT p_size, amount FROM orders WHERE user_id = ?',
        [user_id],
        (err, rows) =>{
          if (err) {
            res.status(500).json({
              error: err.message,
            })
          }else if (rows.length === 0){
            res.status(404).json({
              message: '沒有訂單資料',
            })
          } else {
            res.status(200).json(rows);
          }
        }
      )
    }

  }catch(err){
    console.log(err);
  }
});

//接收USER送出的訂單資料
app.post('/api/order/submit', async (req, res) => {

  const multiOrder = [];
  const orderFromUser = req.body.order;

  
try{
  access_token = req.headers.authorization.split(' ')[1];

  let userInfo = await verifyTokenFromLineAPI(access_token);

  if(userInfo){
    let user_id = userInfo.data.userId;

    const values = orderFromUser.map(item => [user_id ,item.size, item.quantity]);
    console.log(values);

    pool.query(
      'INSERT INTO orders (user_id, p_size, amount) VALUES ?', 
      [values], 
      (err) => {
        if (err) throw err;
        //console.log('已新增訂單資料');
        res.status(200).json({
          message: '已新增訂單資料',
        })
      });

  }else{

    //1.如果token無效，就回傳400，並將前端session清除，重新導向登入頁面
    res.status(403).json({
      message: 'Access_token無效',
    });
  }

}catch(err){
  //如果LINE API出現錯誤，就回傳400，並告知錯誤訊息
  console.log(err);
}

  //1.驗證token是否有效

  //2.如果token有效，就取得使用者資料

  //3.如果取得使用者資料成功，就將訂單資料存入資料庫

});


//驗證token是否有效的API  
app.post('/api/verifytoken', (req, res) => {
  //取得前端請求的access_token
  const access_token = req.headers.authorization.split(' ')[1];

  axios.get (`${verifyIdTokenUrl}?access_token=${access_token}`)
  .then( result => {

    //如果token有效，就再發一次API取得使用者資料
    axios.get(getUserInfoUrl, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
      }
    })
    .then (result => {

      //成功取得使用者資料
      //console.log(result.data);

      res.status(200).json({
        message: 'Access_token驗證並取得使用者資料成功',
        data: result.data,
      });

    })
    .catch ( err => {
      //如果取得使用者資料失敗，就回傳錯誤訊息
      res.status(400).json({
        message: '使用Access_token取得使用者資料失敗',
      })
    })
    console.log('有成功驗證token');
  })
  .catch( err => {
    //如果token無效，就回傳錯誤訊息
    res.status(401).json({
      message: 'Access_token無效',
    });
  })
});

//確認CODE並申請token codefortoken API
app.post('/api/codefortoken', (req, res) => {
  //取得code
  const code = req.body.code;

  //如果沒有code
  if (!code) {
    return res.status(400).json({
      message: 'Server端沒有收到code',
    });
  }

  //向line申請token
  console.log('前端已傳送Code，向line申請token...');
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
    const accessToken = result.data.access_token;
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
      const userPicture = result.data.picture;
      const userEmail = result.data.email;

      console.log('已獲得使用者資料：', userId, userName, userEmail);

      //比對資料庫是否有該使用者資料
      pool.query('SELECT * FROM users WHERE user_id = ?', [userId], (err, rows) => {
        if (err) throw err;

        if (rows.length === 0){
          console.log('資料庫沒有該使用者資料，新增使用者資料...');
          
          //如果資料庫沒有該使用者資料，就先新增資料
          pool.query('INSERT INTO users (user_id, user_name, user_pic, user_email) VALUES (?, ?, ?, ?)', 
          [userId, userName, userPicture, userEmail], (err, rows) => {
            if (err) throw err;
            console.log(`已新增使用者資料：${userId}, ${userName}, ${userPicture}, ${userEmail}`);
          });

          //然後回傳token
          res.status(200).json({
            access_token: accessToken,
            picture: userPicture,
            id_token: idToken,
            sub: userId,
            user_name: userName,
          });

        }else{
          //如果資料庫有該使用者資料，就直接回傳token
          log('資料庫有該使用者資料，直接回傳token');
          res.status(200).json({
            access_token: accessToken,
            id_token: idToken,
            sub: userId,
            picture: userPicture,
            user_name: userName,
          });
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

//確認token是否有效
function verifyTokenFromLineAPI (access_token){
  //路由使用async await接收回傳值，所以這裡使用promise回傳
  return axios.get(`https://api.line.me/oauth2/v2.1/verify?access_token=${access_token}`)
    .then (result => {

      //如果有效期秒數大於0，且client_id正確，就回傳使用者資訊,否則回傳false
      if((result.data.expires_in > 0) && (result.data.client_id === process.env.CLIENT_ID)){
        
        return axios.get('https://api.line.me/v2/profile',{
          headers: {
            'Authorization': `Bearer ${access_token}`,
          }
        })
        
      }else{
        //token valid =API 顯示無效
        return false;
      }
    })

    //如果取得使用者資料成功，就回傳使用者資料，否則回傳false
    .then( userInfo => {
      if(userInfo){
        return userInfo;
      }else{
        return false;
      }
    })

    .catch (err => {
      throw new Error(err.response.data.error_description);
    })
}

app.listen(PORT, () => console.log(`Server started http://localhost:${PORT}`));