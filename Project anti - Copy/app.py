from flask import Flask, render_template

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/operator')
def operator():
    return render_template('operator.html')

@app.route('/responder')
def responder():
    return render_template('responder.html')

@app.route('/citizen')
def citizen():
    return render_template('citizen.html')

if __name__ == '__main__':
    app.run(debug=True, port=5000)
