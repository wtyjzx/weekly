const express = require('express')
const path = require('path')
const fs = require('fs')
const sqlite = require('sqlite')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
const multer = require('multer')
const md5 = require('md5')

const upload = multer({
  dest: './upload/'
})

let db

sqlite.open('./db/weekly.sqlite3').then(value => {
  db = value
})

const app = express()
const port = parseInt(process.argv[2]) || 8000

app.set('view engine', 'pug')

app.locals.pretty = true//让pug输出可读的文档

app.use((req, res, next) => {
  console.log(req.method, req.url)
  next()
})

app.use(express.static('public'))
app.use('/upload', express.static('upload'))

app.use(cookieParser('this is the serect'))

// app.use(function(req, res, next) {
//   console.log(req.headers)
//   req.on('data',d => {
//     console.log(d.toString())
//   })
//   req.on('end', () => {
//     next()
//   })
// })

app.use(bodyParser.urlencoded({extended: true}))
app.use(bodyParser.json())

app.route('/register')
  .get((req, res, next) => {
    res.render('register')
  })
  .post(upload.single('avatar'), async (req, res, next) => {
    console.log('======', req.file, req.body)
    var username = req.body.username
    var password = req.body.password
    console.log(username, password)
    
    try {
      await db.run('INSERT INTO users VALUES (null, ?, ?, ?)', username, password, req.file.path)

      res.cookie('user', username, {
        signed: true
      })
      res.redirect('/')
      // res.render('register-success', {
      //   username,
      // })
    } catch(e) {
      console.log(e)
      res.end('user name already existed')
    }
  })

app.route('/login')
  .get((req, res, next) => {
    res.render('login')
  })
  .post(async (req, res, next) => {
    var username = req.body.username
    var password = req.body.password
    var user = await db.get('SELECT * FROM users WHERE name=? AND password=?', username, password)
    if (user) {
      res.cookie('user', username, {
        signed: true
      })
      res.redirect('/')
    } else {
      res.end('username or password incorrect')
    }
  })

app.get('/logout', async (req, res, next) => {
  res.clearCookie('user')
  res.redirect('/login')
})


app.use(async function getUserInfo(req, res, next) {
  req.user = await db.get('SELECT id,name,avatar FROM users WHERE name=?', req.signedCookies.user)

  console.log(req.user)
  next()
})

app.get('/', async (req, res, next) => {
  var issues
  if (req.user) {
    issues = await db.all('SELECT issues.id,userId,content,timestamp,name,avatar FROM issues JOIN users ON issues.userId=users.id WHERE userId IN (SELECT follow FROM relation WHERE userId=?)', req.user.id)
  } else {
    issues = await db.all('SELECT issues.id,userId,content,timestamp,name,avatar FROM issues JOIN users on issues.userId=users.id ORDER BY timestamp DESC LIMIT 20')
  }
  res.render('index', {
    user: req.user,
    issues,
  })
})

app.get('/user/:id', async (req, res, next) => {
  var issues = await db.all('SELECT issues.id,userId,content,timestamp,name,avatar FROM issues JOIN users on issues.userId=users.id WHERE userId=? ORDER BY timestamp DESC', req.params.id)
  var currUser = await db.get('SELECT * FROM users WHERE id=?', req.params.id)

  var isFollowing = await db.get('SELECT * FROM relation WHERE userId=? AND follow=?', req.user ? req.user.id : null, req.params.id)

  res.render('user', {
    currUser: currUser,
    user: req.user,
    issues: issues,
    isFollowing: isFollowing ? true : false
  })
})

app.use(async (req, res, next) => {
  if (req.user) {
    next()
  } else {
    res.status(401).json({
      code: -1,
      msg: 'user not login'
    })
  }
})

app.route('/issue')
  .get(async (req, res, next) => {
    res.render('write', {
      user: req.user
    })
  })
  .post(async (req, res, next) => {
    var content = req.body.content
    var userId = req.user.id

    console.log(content, userId)

    try {
      await db.run('INSERT INTO issues VALUES (null, ?, ?, ?)', userId, content, Date.now())
      res.redirect('/')
    } catch(e) {
      console.log(e)
      res.end(e)
    }
  })

app.route('/issue/:id')
  .delete(async (req, res, next) => {
    if (req.user) {
      var issue = db.get('SELECT * FROM issues WHERE id=? AND userId=?', req.params.id, req.user.id)
      if (issue) {
        await db.run('DELETE FROM issues WHERE id=?', issue.id)
      }
      res.json({
        code: 0,
        msg: 'ok'
      })
    } else {
      res.status(401).json({
        code: -1,
        msg: 'user not login'
      })
    }
  })

app.route('/issue/:issueId/comments')
  .get(async (req, res, next) => {
    var comments = await db.all('SELECT * FROM comments WHERE issueId=?', req.params.issueId)
    res.json({
      code: 0,
      comments: comments
    })
  })

app.route('/follow/:userId')
  .post(async (req, res, next) => {
    try {
      await db.run('INSERT INTO relation (userId, follow) VALUES (?,?)', req.user.id, req.params.userId)
      res.json({
        code: 0,
        msg: 'ok'
      })
    } catch(e) {
      res.status(401).json({
        code: -1,
        msg: e.toString()
      })
    }
  })
  .delete(async (req, res, next) => {
    await db.run('DELETE FROM relation WHERE userId=? AND follow=?', req.user.id, req.params.userId)
    res.json({
      code: 0,
      msg: 'ok'
    })
  })

app.route('/comment/:issueId')
  .post(async (req, res, next) => {
    var userId = req.user.id
    var issueId = req.params.issueId
    var content = req.body.content

    await db.run('INSERT INTO comments (id,issueId,userId,content) VALUES (null,?,?,?)',issueId, userId, content)
    var row = await db.get('SELECT last_insert_rowid() as id')
    var comment = await db.get('SELECT * FROM comments WHERE id=?', row.id)

    res.json({
      code: 0,
      msg: 'ok',
      data: comment
    })
  })

app.listen(port, () => {
  console.log('Listening on port', port)
})
