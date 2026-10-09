import mongoose from 'mongoose';
const userSchema = new mongoose.Schema({
  email: {type: String, required: true, unique: true},
  passwordHash: {type: String, required: true, select: false},
}, {timestamps: true});
const jobSchema = new mongoose.Schema({
  ownerId: {type: String, required: true, index: true},
  url: {type: String, required: true},
  status: {type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued'},
  attempts: {type: Number, default: 0},
  leaseToken: String, leaseUntil: Date, availableAt: {type: Date, default: Date.now},
  result: mongoose.Schema.Types.Mixed, error: String,
}, {timestamps: true});
jobSchema.index({status: 1, availableAt: 1, leaseUntil: 1});
export const User = mongoose.model('User', userSchema);
export const Job = mongoose.model('Job', jobSchema);
const messageSchema = new mongoose.Schema({
  role: {type: String, enum: ['user', 'assistant'], required: true},
  text: {type: String, required: true}, sources: [String],
}, {_id: false});
const conversationSchema = new mongoose.Schema({
  ownerId: {type: String, required: true},
  title: {type: String, default: 'New conversation'},
  messages: {type: [messageSchema], default: []},
}, {timestamps: true});
conversationSchema.index({ownerId: 1, updatedAt: -1});
export const Conversation = mongoose.model('Conversation', conversationSchema);
